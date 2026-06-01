// Internal implementation note.
// Internal implementation note.
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
  /** Internal implementation note. */
  readonly tp: Transport;
  /** Internal implementation note. */
  readonly llm: LlmFn;

  /**
   * Internal implementation note.
   * Internal implementation note.
   * Internal implementation note.
   */
  private chanBuf: ChannelItem[] = [];
  /** Internal implementation note. */
  private channelSink?: (items: ChannelItem[]) => void | Promise<void>;
  private flushScheduled = false;
  private readonly collectItem = (it: ChannelItem): void => {
    // Internal implementation note.
    // Internal implementation note.
    // Internal implementation note.
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
  /** Internal implementation note. */
  setChannelSink(fn: (items: ChannelItem[]) => void | Promise<void>): void {
    this.channelSink = fn;
  }
  /** Internal implementation note. */
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

  /** Internal implementation note. */
  private tx<T>(fn: () => T): T {
    return withLock(this.ctx, () => {
      this.state = loadState(this.ctx);
      const r = fn();
      saveState(this.ctx, this.state);
      return r;
    });
  }

  /** Internal implementation note. */
  private rx<T>(fn: () => T): T {
    this.state = loadState(this.ctx);
    return fn();
  }

  /**
   * Internal implementation note.
   * Internal implementation note.
   */
  private guard<T>(fn: () => T, onErr: (msg: string) => T): T {
    try {
      return fn();
    } catch (e) {
      return onErr((e as Error).message);
    }
  }

  /**
   * Internal implementation note.
   * Internal implementation note.
   * Internal implementation note.
   * Internal implementation note.
   * Internal implementation note.
   */
  private sendAfterIngest<T>(send: () => T, onErr: (msg: string) => T): T {
    this.tx(() => {
      pollAndIngest(this.tp, this.state, this.collectItem);
    });
    return this.guard(() => this.tx(send), onErr);
  }

  // Internal implementation note.
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
      // Internal implementation note.
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
   * Internal implementation note.
   * Internal implementation note.
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

  /** Internal implementation note. */
  exportProfile(outPath?: string): EngineResult & { path?: string; card?: ProfileCard } {
    return this.rx(() => {
      if (!this.state.profile?.signature) return { ok: false, message: "No profile to export. Create a profile first." };
      const path = outPath ?? join(this.ctx.home, "profile-export.json");
      writeFileSync(path, JSON.stringify(this.state.profile, null, 2), "utf8");
      return { ok: true, message: `Profile exported to ${path}.`, path, card: this.state.profile };
    });
  }

  /** Internal implementation note. */
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

  /** Internal implementation note. */
  invite(): EngineResult & { link?: string } {
    return this.rx(() => {
      if (!this.state.identity) return { ok: false, message: "Run init first." };
      if (!this.state.published) return { ok: false, message: "Publish your profile first." };
      const link = `shellmates://profile/${this.state.identity.agent_id}`;
      return { ok: true, message: `Invite link: ${link}\nIf the peer uses the same directory, they can find you with scan/intro.`, link };
    });
  }

  // Internal implementation note.
  /** Internal implementation note. */
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

  /** Internal implementation note. */
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
      // Internal implementation note.
      this.state.profile = null;
      this.state.published = false;
      this.state.active_chat = null;
      this.state.outbox_intro = null;
      this.state.inbox_intros = [];
      return { ok: true, message: `Key rotated. New agent_id: ${fresh.agent_id}. Create and publish your profile again.`, agent_id: fresh.agent_id };
    });
  }

  // Internal implementation note.
  scan(): EngineResult & { matches: MatchResult[] } {
    // Internal implementation note.
    this.tx(() => {
      pollAndIngest(this.tp, this.state, this.collectItem);
    });
    // Internal implementation note.
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

  // Internal implementation note.
  poll(): IngestResult {
    return this.guard(
      () => this.tx(() => pollAndIngest(this.tp, this.state, this.collectItem)),
      () => ({ ingested: 0, rejected: 0, events: [] }),
    );
  }

  /**
   * Internal implementation note.
   * Internal implementation note.
   * Internal implementation note.
   * Internal implementation note.
   * Internal implementation note.
   */
  channelPoll(): ChannelItem[] {
    // Internal implementation note.
    // Internal implementation note.
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

  /** Internal implementation note. */
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

  // Internal implementation note.
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
