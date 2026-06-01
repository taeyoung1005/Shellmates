// Engine — CLI/MCP/데몬/테스트/데모 공용 상위 오케스트레이션 API.
// 모든 변경 메서드는 withLock으로 reload→mutate→save 를 원자적으로 수행해 멀티 프로세스 레이스를 방지한다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCoaching, coachDraft } from "./coaching.js";
import { resolveCtx, type Ctx } from "./config.js";
import { agentIdFromSignPub, generateIdentity } from "./crypto.js";
import { lookupCard, publishCard, revokeCard, scanCards } from "./directory.js";
import { rankMatches } from "./matching.js";
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
import { loadState, saveState, withLock } from "./store.js";
import type {
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

  constructor(ctx: Ctx) {
    this.ctx = ctx;
    this.state = loadState(ctx);
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

  // ── 신원/프로필 ───────────────────────────────────────────────────
  init(): EngineResult & { agent_id?: string } {
    return this.tx(() => {
      if (this.state.identity) {
        return { ok: true, message: `이미 신원이 있습니다: ${this.state.identity.agent_id}`, agent_id: this.state.identity.agent_id };
      }
      this.state.identity = generateIdentity();
      return { ok: true, message: `키페어 생성 완료. agent_id: ${this.state.identity.agent_id}`, agent_id: this.state.identity.agent_id };
    });
  }

  makeProfile(answers: ProfileAnswers): EngineResult & { card?: ProfileCard } {
    return this.tx(() => {
      if (!this.state.identity) return { ok: false, message: "먼저 init 을 실행하세요." };
      const signed = signProfile(this.state.identity, buildProfile(this.state.identity, answers));
      this.state.profile = signed;
      this.state.published = false;
      return { ok: true, message: "공개 프로필 초안을 생성/서명했습니다. publish 로 게시하세요.", card: signed };
    });
  }

  getProfile(): ProfileCard | null {
    return this.rx(() => this.state.profile);
  }

  publish(): EngineResult {
    return this.tx(() => {
      if (!this.state.identity) return { ok: false, message: "먼저 init." };
      if (!this.state.profile?.signature) return { ok: false, message: "먼저 profile 로 프로필을 만드세요." };
      if (!verifyCard(this.state.profile).ok) return { ok: false, message: "프로필 서명/만료 검증 실패. 다시 생성하세요." };
      publishCard(this.ctx, this.state.profile);
      this.state.published = true;
      return { ok: true, message: "서명된 프로필을 디렉토리에 게시했습니다." };
    });
  }

  unpublish(): EngineResult {
    return this.tx(() => {
      if (!this.state.identity) return { ok: false, message: "먼저 init." };
      revokeCard(this.ctx, this.state.identity.agent_id);
      this.state.published = false;
      return { ok: true, message: "디렉토리에서 프로필을 내렸습니다." };
    });
  }

  /** 서명된 프로필을 파일로 내보내기(오프라인 공유용). */
  exportProfile(outPath?: string): EngineResult & { path?: string; card?: ProfileCard } {
    return this.rx(() => {
      if (!this.state.profile?.signature) return { ok: false, message: "내보낼 프로필이 없습니다. 먼저 profile 생성." };
      const path = outPath ?? join(this.ctx.home, "profile-export.json");
      writeFileSync(path, JSON.stringify(this.state.profile, null, 2), "utf8");
      return { ok: true, message: `프로필을 ${path} 로 내보냈습니다.`, path, card: this.state.profile };
    });
  }

  /** 서명된 프로필 카드를 파일에서 가져와 검증 후 로컬 디렉토리에 추가(매칭 후보로). */
  importProfile(inPath: string): EngineResult & { owner?: string } {
    return this.rx(() => {
      if (!existsSync(inPath)) return { ok: false, message: `파일을 찾을 수 없습니다: ${inPath}` };
      let card: ProfileCard;
      try {
        card = JSON.parse(readFileSync(inPath, "utf8")) as ProfileCard;
      } catch {
        return { ok: false, message: "JSON 파싱 실패." };
      }
      const v = verifyCard(card);
      if (!v.ok) return { ok: false, message: `유효하지 않은 카드입니다(${v.reason}).` };
      publishCard(this.ctx, card);
      return { ok: true, message: `${card.display_name ?? card.owner} 프로필을 가져와 디렉토리에 추가했습니다.`, owner: card.owner };
    });
  }

  /** 초대 링크 생성(내 공개 신원 공유용). */
  invite(): EngineResult & { link?: string } {
    return this.rx(() => {
      if (!this.state.identity) return { ok: false, message: "먼저 init." };
      if (!this.state.published) return { ok: false, message: "먼저 publish 로 프로필을 공개하세요." };
      const link = `terminallove://profile/${this.state.identity.agent_id}`;
      return { ok: true, message: `초대 링크: ${link}\n(상대가 같은 디렉토리를 구독하면 scan/intro로 연결됩니다)`, link };
    });
  }

  // ── 키 관리 ───────────────────────────────────────────────────────
  backupKey(outPath?: string): EngineResult & { path?: string } {
    return this.rx(() => {
      if (!this.state.identity) return { ok: false, message: "백업할 신원이 없습니다." };
      const path = outPath ?? join(this.ctx.home, "key-backup.json");
      writeFileSync(path, JSON.stringify(this.state.identity, null, 2), "utf8");
      return { ok: true, message: `⚠ 개인키 포함 백업을 ${path} 에 저장했습니다. 안전하게 보관하세요.`, path };
    });
  }

  importKey(inPath: string): EngineResult & { agent_id?: string } {
    return this.tx(() => {
      if (!existsSync(inPath)) return { ok: false, message: `파일을 찾을 수 없습니다: ${inPath}` };
      let id: Identity;
      try {
        id = JSON.parse(readFileSync(inPath, "utf8")) as Identity;
      } catch {
        return { ok: false, message: "JSON 파싱 실패." };
      }
      if (!id.sign_pub || !id.sign_priv || !id.box_pub || !id.box_priv || !id.agent_id) {
        return { ok: false, message: "신원 형식이 올바르지 않습니다." };
      }
      if (agentIdFromSignPub(id.sign_pub) !== id.agent_id) {
        return { ok: false, message: "agent_id 바인딩 검증 실패(손상/위조된 키)." };
      }
      this.state.identity = id;
      return { ok: true, message: `신원을 복원했습니다: ${id.agent_id}`, agent_id: id.agent_id };
    });
  }

  rotateKey(): EngineResult & { agent_id?: string } {
    return this.tx(() => {
      if (!this.state.identity) return { ok: false, message: "먼저 init." };
      if (this.state.published) revokeCard(this.ctx, this.state.identity.agent_id);
      const fresh = generateIdentity();
      this.state.identity = fresh;
      // 새 신원이라 기존 프로필/대화/intro는 무효화 → 초기화 후 재생성/재게시 필요
      this.state.profile = null;
      this.state.published = false;
      this.state.active_chat = null;
      this.state.outbox_intro = null;
      this.state.inbox_intros = [];
      return { ok: true, message: `⚠ 키를 교체했습니다. 새 agent_id: ${fresh.agent_id}. 프로필을 다시 만들고 publish 하세요.`, agent_id: fresh.agent_id };
    });
  }

  // ── 디스커버리 ────────────────────────────────────────────────────
  scan(): EngineResult & { matches: MatchResult[] } {
    return this.tx(() => {
      pollAndIngest(this.ctx, this.state);
      if (!this.state.profile) return { ok: false, message: "먼저 프로필을 만드세요 (profile).", matches: [] as MatchResult[] };
      const cards = scanCards(this.ctx);
      const matches = rankMatches(this.state.profile, cards, {
        blocked: this.state.blocked,
        noResuggest: this.state.no_resuggest,
        myAgentId: this.state.identity?.agent_id ?? this.state.profile.owner,
      });
      return { ok: true, message: `${matches.length}명의 매칭 후보를 찾았습니다.`, matches };
    });
  }

  lookup(agentId: string): ProfileCard | null {
    return lookupCard(this.ctx, agentId);
  }

  // ── 메시징 ────────────────────────────────────────────────────────
  poll(): IngestResult {
    return this.tx(() => pollAndIngest(this.ctx, this.state));
  }

  intro(target: string, firstMessage?: string): EngineResult {
    return this.tx(() => {
      pollAndIngest(this.ctx, this.state);
      return sendIntro(this.ctx, this.state, target, firstMessage);
    });
  }

  cancel(): EngineResult {
    return this.tx(() => cancelIntro(this.ctx, this.state));
  }

  inbox(): EngineResult & { intros: IntroRecord[] } {
    return this.tx(() => {
      pollAndIngest(this.ctx, this.state);
      return { ok: true, message: `받은 intro ${this.state.inbox_intros.length}건.`, intros: this.state.inbox_intros };
    });
  }

  accept(introId: string): EngineResult {
    return this.tx(() => {
      pollAndIngest(this.ctx, this.state);
      return acceptIntro(this.ctx, this.state, introId);
    });
  }

  decline(introId: string): EngineResult {
    return this.tx(() => {
      pollAndIngest(this.ctx, this.state);
      return declineIntro(this.ctx, this.state, introId);
    });
  }

  /** 현재 1:1 대화 + 코칭 반환. 읽음 처리. */
  open(): EngineResult & { chat: Chat | null; coaching?: CoachingPayload; cold?: boolean } {
    return this.tx(() => {
      pollAndIngest(this.ctx, this.state);
      const chat = this.state.active_chat;
      const cold = coldCheck(this.state);
      this.state.notifications = { ...this.state.notifications, unread: 0 };
      if (!chat) return { ok: false, message: "열린 1:1 대화가 없습니다. scan → intro 로 시작하세요.", chat: null };
      return { ok: true, message: "현재 대화", chat, coaching: buildCoaching(chat), cold };
    });
  }

  send(text: string): EngineResult {
    return this.tx(() => {
      pollAndIngest(this.ctx, this.state);
      return sendMessage(this.ctx, this.state, text);
    });
  }

  reply(): EngineResult & { coaching?: CoachingPayload } {
    return this.tx(() => {
      pollAndIngest(this.ctx, this.state);
      const chat = this.state.active_chat;
      if (!chat) return { ok: false, message: "열린 대화가 없습니다." };
      return { ok: true, message: "답장 코칭", coaching: buildCoaching(chat) };
    });
  }

  coach(draft: string): EngineResult & { coaching?: CoachingPayload } {
    return this.rx(() => {
      const chat = this.state.active_chat;
      if (!chat) return { ok: false, message: "열린 대화가 없습니다." };
      return { ok: true, message: "초안 코칭", coaching: coachDraft(chat, draft) };
    });
  }

  end(block = false): EngineResult {
    return this.tx(() => endChat(this.ctx, this.state, block));
  }

  block(agentId?: string): EngineResult {
    return this.tx(() => blockAgent(this.ctx, this.state, agentId));
  }

  report(agentId: string, reason: string): EngineResult {
    return this.tx(() => reportAgent(this.state, agentId, reason));
  }

  alias(name: string): EngineResult {
    return this.tx(() => {
      if (!this.state.active_chat) return { ok: false, message: "별명을 붙일 활성 대화가 없습니다." };
      this.state.active_chat.alias = name;
      return { ok: true, message: `현재 상대 별명을 @${name} 로 설정했습니다.` };
    });
  }

  // ── 알림/상태 ─────────────────────────────────────────────────────
  notificationState(): NotificationState {
    return this.tx(() => {
      pollAndIngest(this.ctx, this.state);
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
