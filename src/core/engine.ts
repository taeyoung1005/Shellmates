// Engine — CLI/MCP/데몬/테스트/데모 공용 상위 오케스트레이션 API.
// 모든 변경 메서드는 withLock으로 reload→mutate→save 를 원자적으로 수행해 멀티 프로세스 레이스를 방지한다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coachDraft, coachReply } from "./coaching.js";
import { resolveCtx, type Ctx } from "./config.js";
import { agentIdFromSignPub, decryptWithPassphrase, encryptWithPassphrase, generateIdentity, isSecretBox } from "./crypto.js";
import { defaultLlm, type LlmFn } from "./llm.js";
import { rankMatches } from "./matching.js";
import { observeProfile, type ObserveResult } from "./observe.js";
import {
  acceptIntro,
  blockAgent,
  cancelIntro,
  coldCheck,
  declineIntro,
  endChat,
  pollAndIngest,
  reportAgent,
  sendIntro,
  sendMessage,
  type IngestResult,
} from "./messaging.js";
import { buildProfile, signProfile, verifyCard } from "./profile.js";
import { loadState, saveState, withLock, writeSecretFile } from "./store.js";
import { getTransport, type Transport } from "./transport.js";
import type {
  ChannelItem,
  Chat,
  CoachingPayload,
  Identity,
  IntroRecord,
  MatchResult,
  NotificationState,
  ProfileAnswers,
  ProfileCard,
  State,
} from "./types.js";

export interface EngineResult {
  ok: boolean;
  message: string;
}

export class Engine {
  readonly ctx: Ctx;
  state: State;
  /** 활성 transport(LocalFs 또는 Http). 신원은 매 호출 시 현재 state에서 lazy하게 읽음. */
  readonly tp: Transport;
  /** 코칭/관찰 요약용 LLM(TL_LLM). 미설정 시 ()=>null → 휴리스틱 폴백. */
  readonly llm: LlmFn;

  /**
   * 채널 수집 버퍼 — 모든 ingest 경로(폴 루프 + 도구 호출)가 새로 반영된 수신 항목을 여기 쌓는다.
   * 채널 서버가 폴 루프/도구 호출 후 drainChannelItems()로 꺼내 push → destructive-poll 경쟁으로
   * 메시지가 채널 push 없이 삼켜지는 것을 방지(PLAN3 §13: 단일 engine, 모든 ingest가 channelize).
   */
  private chanBuf: ChannelItem[] = [];
  /** 설정 시(채널 서버): 도구 호출로 ingest된 새 항목을 microtask에서 drain→push. */
  private channelSink?: (items: ChannelItem[]) => void | Promise<void>;
  private flushScheduled = false;
  private readonly collectItem = (it: ChannelItem): void => {
    // sink가 없으면(standalone full MCP / CLI / 테스트) 버퍼링하지 않음 → 기존 동작 보존.
    // sink가 있으면(채널 서버) 도구 호출이 부수적으로 ingest한 항목을 모아, 현재 동기 tx가 끝난 뒤
    // 한 번만 drain→push 예약. (channelPoll은 별도 로컬 배열을 쓰므로 중복 push 없음.)
    if (!this.channelSink) return;
    this.chanBuf.push(it);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => {
        this.flushScheduled = false;
        const items = this.drainChannelItems();
        if (items.length && this.channelSink) void this.channelSink(items);
      });
    }
  };
  /** 채널 서버가 도구-경로 ingest 항목을 받을 sink 등록. */
  setChannelSink(fn: (items: ChannelItem[]) => void | Promise<void>): void {
    this.channelSink = fn;
  }
  /** 버퍼에 쌓인 채널 항목을 꺼내고 비운다. */
  drainChannelItems(): ChannelItem[] {
    return this.chanBuf.splice(0);
  }

  constructor(ctx: Ctx, transport?: Transport) {
    this.ctx = ctx;
    this.state = loadState(ctx);
    this.tp = transport ?? getTransport(ctx, () => this.state.identity);
    this.llm = defaultLlm();
  }

  static open(env: NodeJS.ProcessEnv = process.env): Engine {
    return new Engine(resolveCtx(env));
  }

  reload(): void {
    this.state = loadState(this.ctx);
  }

  save(): void {
    saveState(this.ctx, this.state);
  }

  get agentId(): string | null {
    return this.state.identity?.agent_id ?? null;
  }

  /** 락 보호하에 reload→mutate→save 를 원자적으로 수행 */
  private tx<T>(fn: () => T): T {
    return withLock(this.ctx, () => {
      this.state = loadState(this.ctx);
      const r = fn();
      saveState(this.ctx, this.state);
      return r;
    });
  }

  /** 읽기 전용: 최신 상태 reload 후 fn (저장 없음). saveState가 원자적이라 락 불필요. */
  private rx<T>(fn: () => T): T {
    this.state = loadState(this.ctx);
    return fn();
  }

  /**
   * 네트워크 transport 오류(서버 미가용/거부 등 throw)를 EngineResult 실패로 변환.
   * LocalFs 모드에선 transport가 throw하지 않으므로 사실상 no-op(기존 동작 불변).
   */
  private guard<T>(fn: () => T, onErr: (msg: string) => T): T {
    try {
      return fn();
    } catch (e) {
      return onErr((e as Error).message);
    }
  }

  /**
   * poll-then-send 패턴의 원자성 보장(HIGH 버그 수정).
   * pollAndIngest는 수신 봉투를 로컬에 반영 + relay에서 DELETE(ack, 비가역)한다.
   * 이를 send와 같은 tx에 두면, 이후 send가 throw(서버 429/5xx 등)할 때 tx가 롤백되어
   * "이미 서버에서 삭제된" 수신 메시지가 로컬에도 저장되지 않아 영구 유실된다.
   * → ingest를 먼저 독립 tx로 커밋(durable)한 뒤, 순수 send만 guarded tx로 수행한다.
   */
  private sendAfterIngest<T>(send: () => T, onErr: (msg: string) => T): T {
    this.tx(() => {
      pollAndIngest(this.tp, this.state, this.collectItem);
    });
    return this.guard(() => this.tx(send), onErr);
  }

  // ── 신원/프로필 ───────────────────────────────────────────────────
  init(): EngineResult & { agent_id?: string } {
    return this.tx(() => {
      if (this.state.identity) {
        return { ok: true, message: `Identity already exists: ${this.state.identity.agent_id}`, agent_id: this.state.identity.agent_id };
      }
      this.state.identity = generateIdentity();
      return { ok: true, message: `Keypair created. agent_id: ${this.state.identity.agent_id}`, agent_id: this.state.identity.agent_id };
    });
  }

  makeProfile(answers: ProfileAnswers): EngineResult & { card?: ProfileCard } {
    return this.tx(() => {
      if (!this.state.identity) return { ok: false, message: "Run init first." };
      // federation 힌트: 명시값 없고 서버 모드면 내 home relay를 카드에 기록(v1 라우팅 미사용, 예약).
      const enriched: ProfileAnswers =
        !answers.home_relay && this.ctx.server ? { ...answers, home_relay: this.ctx.server.baseUrl } : answers;
      const signed = signProfile(this.state.identity, buildProfile(this.state.identity, enriched));
      this.state.profile = signed;
      this.state.published = false;
      return { ok: true, message: "Public profile draft created and signed. Run publish to publish it.", card: signed };
    });
  }

  getProfile(): ProfileCard | null {
    return this.rx(() => this.state.profile);
  }

  /**
   * Phase 2F: 로컬 코딩 에이전트 기록을 관찰해 프로필 초안(ProfileAnswers)을 만든다.
   * 데이터는 로컬에서만 처리되며, 결과는 초안일 뿐 자동 게시하지 않는다(CLI에서 검토 후 publish).
   */
  observeForProfile(opts?: { roots?: string[] }): ObserveResult {
    return observeProfile({ llm: this.llm, ...(opts?.roots ? { roots: opts.roots } : {}) });
  }

  publish(): EngineResult {
    return this.guard(
      () =>
        this.tx(() => {
          if (!this.state.identity) return { ok: false, message: "Run init first." };
          if (!this.state.profile?.signature) return { ok: false, message: "Create a profile first." };
          if (!verifyCard(this.state.profile).ok) return { ok: false, message: "Profile signature or expiry validation failed. Create it again." };
          this.tp.publishCard(this.state.profile);
          this.state.published = true;
          return { ok: true, message: "Signed profile published to the directory." };
        }),
      (m) => ({ ok: false, message: `Publish failed: ${m}` }),
    );
  }

  unpublish(): EngineResult {
    return this.tx(() => {
      if (!this.state.identity) return { ok: false, message: "Run init first." };
      this.tp.revokeCard(this.state.identity.agent_id);
      this.state.published = false;
      return { ok: true, message: "Profile removed from the directory." };
    });
  }

  /** 서명된 프로필을 파일로 내보내기(오프라인 공유용). */
  exportProfile(outPath?: string): EngineResult & { path?: string; card?: ProfileCard } {
    return this.rx(() => {
      if (!this.state.profile?.signature) return { ok: false, message: "No profile to export. Create a profile first." };
      const path = outPath ?? join(this.ctx.home, "profile-export.json");
      writeFileSync(path, JSON.stringify(this.state.profile, null, 2), "utf8");
      return { ok: true, message: `Profile exported to ${path}.`, path, card: this.state.profile };
    });
  }

  /** 서명된 프로필 카드를 파일에서 가져와 검증 후 로컬 디렉토리에 추가(매칭 후보로). */
  importProfile(inPath: string): EngineResult & { owner?: string } {
    return this.rx(() => {
      if (!existsSync(inPath)) return { ok: false, message: `File not found: ${inPath}` };
      let card: ProfileCard;
      try {
        card = JSON.parse(readFileSync(inPath, "utf8")) as ProfileCard;
      } catch {
        return { ok: false, message: "JSON parse failed." };
      }
      const v = verifyCard(card);
      if (!v.ok) return { ok: false, message: `Invalid card (${v.reason}).` };
      return this.guard<EngineResult & { owner?: string }>(
        () => {
          this.tp.publishCard(card);
          return { ok: true, message: `Imported ${card.display_name ?? card.owner}'s profile into the directory.`, owner: card.owner };
        },
        (m) => ({ ok: false, message: `Profile import failed: ${m}` }),
      );
    });
  }

  /** 초대 링크 생성(내 공개 신원 공유용). */
  invite(): EngineResult & { link?: string } {
    return this.rx(() => {
      if (!this.state.identity) return { ok: false, message: "Run init first." };
      if (!this.state.published) return { ok: false, message: "Publish your profile first." };
      const link = `shellmates://profile/${this.state.identity.agent_id}`;
      return { ok: true, message: `Invite link: ${link}\nIf the peer uses the same directory, they can find you with scan/intro.`, link };
    });
  }

  // ── 키 관리 ───────────────────────────────────────────────────────
  /** 개인키 백업. passphrase 주면 scrypt+AES-GCM으로 암호화 저장(권장, PLAN §10). 파일은 0600. */
  backupKey(outPath?: string, passphrase?: string): EngineResult & { path?: string; encrypted?: boolean } {
    return this.rx(() => {
      if (!this.state.identity) return { ok: false, message: "No identity to back up." };
      const path = outPath ?? join(this.ctx.home, "key-backup.json");
      const plain = JSON.stringify(this.state.identity, null, 2);
      if (passphrase && passphrase.length > 0) {
        const box = encryptWithPassphrase(plain, passphrase);
        writeSecretFile(path, JSON.stringify(box, null, 2)); // preserve 0600 even on overwrite
        return { ok: true, message: `Encrypted key backup saved to ${path} (0600).`, path, encrypted: true };
      }
      writeSecretFile(path, plain);
      return { ok: true, message: `Plaintext private-key backup saved to ${path} (0600). Using --passphrase is recommended.`, path, encrypted: false };
    });
  }

  /** 키 복원. 파일이 암호화된 백업이면 passphrase 필요. */
  importKey(inPath: string, passphrase?: string): EngineResult & { agent_id?: string } {
    return this.tx(() => {
      if (!existsSync(inPath)) return { ok: false, message: `File not found: ${inPath}` };
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(inPath, "utf8"));
      } catch {
        return { ok: false, message: "JSON parse failed." };
      }
      let id: Identity;
      if (isSecretBox(parsed)) {
        if (!passphrase) return { ok: false, message: "This backup is encrypted. Provide --passphrase." };
        try {
          id = JSON.parse(decryptWithPassphrase(parsed, passphrase)) as Identity;
        } catch {
          return { ok: false, message: "Decryption failed. The passphrase is wrong or the backup is damaged." };
        }
      } else {
        id = parsed as Identity;
      }
      if (!id || !id.sign_pub || !id.sign_priv || !id.box_pub || !id.box_priv || !id.agent_id) {
        return { ok: false, message: "Invalid identity format." };
      }
      if (agentIdFromSignPub(id.sign_pub) !== id.agent_id) {
        return { ok: false, message: "agent_id binding validation failed. The key is damaged or forged." };
      }
      this.state.identity = id;
      return { ok: true, message: `Identity restored: ${id.agent_id}`, agent_id: id.agent_id };
    });
  }

  rotateKey(): EngineResult & { agent_id?: string } {
    return this.tx(() => {
      if (!this.state.identity) return { ok: false, message: "Run init first." };
      if (this.state.published) this.tp.revokeCard(this.state.identity.agent_id);
      const fresh = generateIdentity();
      this.state.identity = fresh;
      // 새 신원이라 기존 프로필/대화/intro는 무효화 → 초기화 후 재생성/재게시 필요
      this.state.profile = null;
      this.state.published = false;
      this.state.active_chat = null;
      this.state.outbox_intro = null;
      this.state.inbox_intros = [];
      return { ok: true, message: `Key rotated. New agent_id: ${fresh.agent_id}. Create and publish your profile again.`, agent_id: fresh.agent_id };
    });
  }

  // ── 디스커버리 ────────────────────────────────────────────────────
  scan(): EngineResult & { matches: MatchResult[] } {
    // 1) 수신 ingest를 먼저 durable 커밋(비가역 relay DELETE가 롤백되지 않도록 — sendAfterIngest와 동일 원칙).
    this.tx(() => {
      pollAndIngest(this.tp, this.state, this.collectItem);
    });
    // 2) fallible한 디렉토리 읽기(scanCards)는 저장 없는 guarded read로 분리 → throw해도 ingest 유실 없음.
    return this.guard(
      () =>
        this.rx(() => {
          if (!this.state.profile) return { ok: false, message: "Create a profile first.", matches: [] as MatchResult[] };
          const cards = this.tp.scanCards();
          const matches = rankMatches(this.state.profile, cards, {
            blocked: this.state.blocked,
            noResuggest: this.state.no_resuggest,
            myAgentId: this.state.identity?.agent_id ?? this.state.profile.owner,
          });
          return { ok: true, message: `Found ${matches.length} match candidate(s).`, matches };
        }),
      (m) => ({ ok: false, message: `Scan failed: ${m}`, matches: [] as MatchResult[] }),
    );
  }

  lookup(agentId: string): ProfileCard | null {
    try {
      return this.tp.lookupCard(agentId);
    } catch {
      return null;
    }
  }

  // ── 메시징 ────────────────────────────────────────────────────────
  poll(): IngestResult {
    return this.guard(
      () => this.tx(() => pollAndIngest(this.tp, this.state, this.collectItem)),
      () => ({ ingested: 0, rejected: 0, events: [] }),
    );
  }

  /**
   * 실시간 채널(PLAN3 §13) 전용 폴링 — relay를 ingest하면서 새로 반영된 수신 항목을
   * 본문 포함 ChannelItem[]로 수집해 반환한다. poll()과 동일한 durable-ingest + guard 안전 프로파일:
   * - tx 안에서 ingest(비가역 relay DELETE 포함)를 커밋 → 메시지 유실 방지.
   * - collector는 배열 push만 하므로 throw 불가 → pollAndIngest의 hostile-input 내성과 동일.
   * - 네트워크 transport throw는 guard로 흡수 → []. (데이팅 세션 전용이라 본문 수집은 의도된 동작.)
   */
  channelPoll(): ChannelItem[] {
    // 폴 루프 전용: 로컬 배열로 수집해 반환(채널 서버 channelTick이 push). chanBuf와 분리 →
    // 도구-경로(sink) 버퍼와 섞이지 않음. destructive-read라 같은 메시지를 양쪽이 중복 처리하지 않음.
    const items: ChannelItem[] = [];
    this.guard(
      () =>
        this.tx(() => {
          pollAndIngest(this.tp, this.state, (it) => items.push(it));
        }),
      () => undefined,
    );
    return items;
  }

  intro(target: string, firstMessage?: string): EngineResult {
    return this.sendAfterIngest(
      () => sendIntro(this.tp, this.state, target, firstMessage),
      (m) => ({ ok: false, message: `Intro send failed: ${m}` }),
    );
  }

  cancel(): EngineResult {
    return this.tx(() => cancelIntro(this.state));
  }

  inbox(): EngineResult & { intros: IntroRecord[] } {
    return this.tx(() => {
      pollAndIngest(this.tp, this.state, this.collectItem);
      return { ok: true, message: `${this.state.inbox_intros.length} received intro(s).`, intros: this.state.inbox_intros };
    });
  }

  accept(introId: string): EngineResult {
    return this.sendAfterIngest(
      () => acceptIntro(this.tp, this.state, introId),
      (m) => ({ ok: false, message: `Accept failed: ${m}` }),
    );
  }

  decline(introId: string): EngineResult {
    return this.sendAfterIngest(
      () => declineIntro(this.tp, this.state, introId),
      (m) => ({ ok: false, message: `Decline failed: ${m}` }),
    );
  }

  /** 현재 1:1 대화 + 코칭 반환. 읽음 처리. */
  open(): EngineResult & { chat: Chat | null; coaching?: CoachingPayload; cold?: boolean } {
    return this.tx(() => {
      pollAndIngest(this.tp, this.state, this.collectItem);
      const chat = this.state.active_chat;
      const cold = coldCheck(this.state);
      this.state.notifications = { ...this.state.notifications, unread: 0 };
      if (!chat) return { ok: false, message: "No open 1:1 chat. Start with scan -> intro.", chat: null };
      return { ok: true, message: "Current chat", chat, coaching: coachReply(chat, this.llm), cold };
    });
  }

  send(text: string): EngineResult {
    return this.sendAfterIngest(
      () => sendMessage(this.tp, this.state, text),
      (m) => ({ ok: false, message: `Send failed: ${m}` }),
    );
  }

  reply(): EngineResult & { coaching?: CoachingPayload } {
    return this.tx(() => {
      pollAndIngest(this.tp, this.state, this.collectItem);
      const chat = this.state.active_chat;
      if (!chat) return { ok: false, message: "No open chat." };
      return { ok: true, message: "Reply coaching", coaching: coachReply(chat, this.llm) };
    });
  }

  coach(draft: string): EngineResult & { coaching?: CoachingPayload } {
    return this.rx(() => {
      const chat = this.state.active_chat;
      if (!chat) return { ok: false, message: "No open chat." };
      return { ok: true, message: "Draft coaching", coaching: coachDraft(chat, draft, this.llm) };
    });
  }

  end(block = false): EngineResult {
    return this.guard(
      () => this.tx(() => endChat(this.tp, this.state, block)),
      (m) => ({ ok: false, message: `End failed: ${m}` }),
    );
  }

  block(agentId?: string): EngineResult {
    return this.guard(
      () => this.tx(() => blockAgent(this.tp, this.state, agentId)),
      (m) => ({ ok: false, message: `Block failed: ${m}` }),
    );
  }

  report(agentId: string, reason: string): EngineResult {
    return this.tx(() => reportAgent(this.state, agentId, reason));
  }

  alias(name: string): EngineResult {
    return this.tx(() => {
      if (!this.state.active_chat) return { ok: false, message: "No active chat to alias." };
      this.state.active_chat.alias = name;
      return { ok: true, message: `Current peer alias set to @${name}.` };
    });
  }

  // ── 알림/상태 ─────────────────────────────────────────────────────
  notificationState(): NotificationState {
    return this.tx(() => {
      pollAndIngest(this.tp, this.state, this.collectItem);
      return this.state.notifications;
    });
  }

  status(): {
    agent_id: string | null;
    published: boolean;
    has_profile: boolean;
    active_partner: string | null;
    pending_outbox: string | null;
    inbox: number;
    unread: number;
    blocked: number;
    past_chats: number;
  } {
    return this.rx(() => ({
      agent_id: this.agentId,
      published: this.state.published,
      has_profile: !!this.state.profile,
      active_partner: this.state.active_chat
        ? this.state.active_chat.alias ?? this.state.active_chat.partner_profile.display_name ?? this.state.active_chat.partner.agent_id
        : null,
      pending_outbox: this.state.outbox_intro?.to ?? null,
      inbox: this.state.inbox_intros.length,
      unread: this.state.notifications.unread,
      blocked: this.state.blocked.length,
      past_chats: this.state.past_chats.length,
    }));
  }
}
