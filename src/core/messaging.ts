// Human-to-human messaging: intro/accept/decline handshake, encrypted 1:1 chat,
// and the poll-and-ingest loop that verifies, deduplicates, and applies inbound
// signed envelopes to local State.
import {
  agentIdFromSignPub,
  decryptFrom,
  encryptFor,
  publicIdentity,
  signEnvelope,
  verifyEnvelope,
} from "./crypto.js";
import { verifyCard } from "./profile.js";
import { sanitizeIncoming } from "./safety.js";
import type { Transport } from "./transport.js";
import type {
  ChannelCollector,
  Chat,
  ChatMessage,
  Envelope,
  IntroRecord,
  OpResult,
  PublicIdentity,
  PublicProfileCard,
  State,
} from "./types.js";
import { PROTOCOL_VERSION } from "./types.js";
import { newId, newNonce, nowIso } from "./util.js";

const SEEN_CAP = 2000;
const SEEN_CONVERSATION_CAP = 1000;
const FIRST_MESSAGE_MAX_CHARS = 2000;
const INBOX_INTRO_CAP = 50;
const MAX_CHAT_MESSAGES = 1000;
const PAST_CHATS_CAP = 200;

export type Result = OpResult;

export interface IngestResult {
  ingested: number;
  rejected: number;
  events: string[];
}

function identityFromCard(card: PublicProfileCard): PublicIdentity {
  return { agent_id: card.owner, sign_pub: card.sign_pub, box_pub: card.box_pub };
}

function aliasOf(state: State, agentId: string, fallbackName?: string): string {
  if (state.active_chat && state.active_chat.partner.agent_id === agentId && state.active_chat.alias) {
    return state.active_chat.alias;
  }
  return fallbackName || agentId;
}

function setNotify(state: State, event: string, fromAgent: string | null, alias: string | null, incUnread: boolean): void {
  state.notifications = {
    unread: incUnread ? state.notifications.unread + 1 : state.notifications.unread,
    last_from_alias: alias,
    last_from_agent: fromAgent,
    last_event: event,
    updated_at: nowIso(),
  };
}

function markSeen(state: State, id: string): void {
  state.seen_env.push(id);
  if (state.seen_env.length > SEEN_CAP) {
    state.seen_env = state.seen_env.slice(-SEEN_CAP);
  }
}

function markConversation(state: State, conv: string): void {
  if (!state.seen_conversations) state.seen_conversations = [];
  if (state.seen_conversations.includes(conv)) return;
  state.seen_conversations.push(conv);
  if (state.seen_conversations.length > SEEN_CONVERSATION_CAP) {
    state.seen_conversations = state.seen_conversations.slice(-SEEN_CONVERSATION_CAP);
  }
}

function pushPastChat(state: State, chat: Chat): void {
  state.past_chats.push(chat);
  if (state.past_chats.length > PAST_CHATS_CAP) {
    state.past_chats.splice(0, state.past_chats.length - PAST_CHATS_CAP);
  }
}

function pushMessage(chat: Chat, direction: "in" | "out", from: string, text: string, flagged?: boolean, flags?: string[]): ChatMessage {
  const msg: ChatMessage = {
    msg_id: newId("msg"),
    direction,
    from,
    text,
    created_at: nowIso(),
    ...(flagged ? { flagged: true, flags: flags ?? [] } : {}),
  };
  chat.messages.push(msg);
  // Bound conversation history so the serialized State (rewritten every poll tick) cannot
  // grow without limit; the UI only ever shows the most recent messages.
  if (chat.messages.length > MAX_CHAT_MESSAGES) {
    chat.messages.splice(0, chat.messages.length - MAX_CHAT_MESSAGES);
  }
  chat.last_activity = msg.created_at;
  return msg;
}

// --- Outbound actions -------------------------------------------------------

/**
 * Send a signed `intro` envelope to a target agent, optionally with an encrypted
 * first message. Enforces the single-active-chat and single-pending-intro
 * invariants and records the pending intro in `outbox_intro`.
 */
export function sendIntro(tp: Transport, state: State, targetAgentId: string, firstMessage?: string): Result {
  if (!state.identity) return { ok: false, message: "Run init first (/shellmates init)." };
  if (!state.profile?.signature) return { ok: false, message: "Create and publish your profile first (/shellmates profile, /shellmates publish)." };
  if (targetAgentId === state.identity.agent_id) return { ok: false, message: "You cannot intro yourself." };
  if (state.blocked.includes(targetAgentId)) return { ok: false, message: "This peer is blocked." };
  if (state.active_chat) {
    return { ok: false, message: `You are already in a 1:1 chat with ${aliasOf(state, state.active_chat.partner.agent_id, state.active_chat.partner_profile.display_name)}. End it first: /shellmates end` };
  }
  if (state.outbox_intro) {
    return { ok: false, message: "You already have a pending outbound intro. Only one is allowed at a time. Cancel it with /shellmates cancel." };
  }

  const card = tp.lookupCard(targetAgentId);
  if (!card) return { ok: false, message: "Target not found in the directory; it may be unpublished, expired, or unavailable." };

  const conversation_id = newId("chat");
  const me = state.identity;
  const fm = firstMessage ? firstMessage.slice(0, FIRST_MESSAGE_MAX_CHARS) : undefined;
  const env: Envelope = {
    type: "intro",
    v: PROTOCOL_VERSION,
    id: newId("env"),
    from: me.agent_id,
    to: targetAgentId,
    conversation_id,
    created_at: nowIso(),
    nonce: newNonce(),
    sender_identity: publicIdentity(me),
    sender_profile: state.profile,
    ...(fm ? { body: encryptFor(fm, card.box_pub, me) } : {}),
  };
  tp.sendEnvelope(signEnvelope(env, me));

  state.outbox_intro = {
    intro_id: newId("intro"),
    conversation_id,
    peer: identityFromCard(card),
    to: targetAgentId,
    profile: card,
    ...(fm ? { first_message: fm } : {}),
    created_at: nowIso(),
    status: "pending",
    direction: "out",
  };
  return { ok: true, message: `Intro sent to ${targetAgentId}. A 1:1 chat opens if they accept.` };
}

/** Drop the pending outbound intro locally (no envelope is sent to the peer). */
export function cancelIntro(state: State): Result {
  if (!state.outbox_intro) return { ok: false, message: "No pending intro." };
  const to = state.outbox_intro.to;
  state.outbox_intro = null;
  return { ok: true, message: `Canceled intro to ${to}.` };
}

/**
 * Accept an inbound intro: open the 1:1 chat, fold in any sanitized first
 * message, send a signed `intro_accept` envelope, and remove the intro from the
 * inbox.
 */
export function acceptIntro(tp: Transport, state: State, introId: string): Result {
  if (!state.identity) return { ok: false, message: "Run init first." };
  if (state.active_chat) return { ok: false, message: "You are already in a 1:1 chat. End it first (/shellmates end)." };
  const intro = state.inbox_intros.find((i) => i.intro_id === introId || i.conversation_id === introId);
  if (!intro) return { ok: false, message: "Intro not found." };

  const me = state.identity;
  const chat: Chat = {
    chat_id: intro.conversation_id,
    conversation_id: intro.conversation_id,
    partner: intro.peer,
    partner_profile: intro.profile,
    alias: null,
    status: "active",
    created_at: nowIso(),
    last_activity: nowIso(),
    messages: [],
  };
  if (intro.first_message) {
    const s = sanitizeIncoming(intro.first_message);
    pushMessage(chat, "in", intro.peer.agent_id, s.text, s.flagged, s.flags);
  }

  const env: Envelope = {
    type: "intro_accept",
    v: PROTOCOL_VERSION,
    id: newId("env"),
    from: me.agent_id,
    to: intro.peer.agent_id,
    conversation_id: intro.conversation_id,
    created_at: nowIso(),
    nonce: newNonce(),
  };
  tp.sendEnvelope(signEnvelope(env, me));

  state.active_chat = chat;
  state.inbox_intros = state.inbox_intros.filter((i) => i.intro_id !== intro.intro_id);
  return { ok: true, message: `Intro accepted. 1:1 chat opened with ${intro.profile.display_name ?? intro.peer.agent_id}.` };
}

/** Decline an inbound intro: send a signed `intro_decline` and drop it from the inbox. */
export function declineIntro(tp: Transport, state: State, introId: string): Result {
  if (!state.identity) return { ok: false, message: "Run init first." };
  const intro = state.inbox_intros.find((i) => i.intro_id === introId || i.conversation_id === introId);
  if (!intro) return { ok: false, message: "Intro not found." };
  const env: Envelope = {
    type: "intro_decline",
    v: PROTOCOL_VERSION,
    id: newId("env"),
    from: state.identity.agent_id,
    to: intro.peer.agent_id,
    conversation_id: intro.conversation_id,
    created_at: nowIso(),
    nonce: newNonce(),
  };
  tp.sendEnvelope(signEnvelope(env, state.identity));
  state.inbox_intros = state.inbox_intros.filter((i) => i.intro_id !== intro.intro_id);
  return { ok: true, message: "Intro declined." };
}

/**
 * Encrypt `text` to the active chat partner's box key, send it as a signed
 * `message` envelope, and append it to the local chat as an outbound message.
 */
export function sendMessage(tp: Transport, state: State, text: string): Result {
  if (!state.identity) return { ok: false, message: "Run init first." };
  const chat = state.active_chat;
  if (!chat || chat.status !== "active") return { ok: false, message: "No open chat. Start with intro/accept first." };
  if (!text.trim()) return { ok: false, message: "Cannot send an empty message." };

  const me = state.identity;
  const env: Envelope = {
    type: "message",
    v: PROTOCOL_VERSION,
    id: newId("env"),
    from: me.agent_id,
    to: chat.partner.agent_id,
    conversation_id: chat.conversation_id,
    created_at: nowIso(),
    nonce: newNonce(),
    body: encryptFor(text, chat.partner.box_pub, me),
  };
  tp.sendEnvelope(signEnvelope(env, me));
  pushMessage(chat, "out", me.agent_id, text);
  return { ok: true, message: "Sent." };
}

/**
 * End the active chat: send a signed `end` envelope, mark the chat ended, add the
 * partner to `no_resuggest` (and `blocked` if `block`), and archive it to past_chats.
 */
export function endChat(tp: Transport, state: State, block = false): Result {
  if (!state.identity) return { ok: false, message: "Run init first." };
  const chat = state.active_chat;
  if (!chat) return { ok: false, message: "No chat to end." };

  const env: Envelope = {
    type: "end",
    v: PROTOCOL_VERSION,
    id: newId("env"),
    from: state.identity.agent_id,
    to: chat.partner.agent_id,
    conversation_id: chat.conversation_id,
    created_at: nowIso(),
    nonce: newNonce(),
  };
  tp.sendEnvelope(signEnvelope(env, state.identity));

  chat.status = "ended";
  chat.ended_at = nowIso();
  if (!state.no_resuggest.includes(chat.partner.agent_id)) state.no_resuggest.push(chat.partner.agent_id);
  if (block && !state.blocked.includes(chat.partner.agent_id)) state.blocked.push(chat.partner.agent_id);
  pushPastChat(state, chat);
  const who = chat.partner_profile.display_name ?? chat.partner.agent_id;
  state.active_chat = null;
  return { ok: true, message: block ? `Ended the chat with ${who} and blocked them.` : `Ended the chat with ${who}.` };
}

/**
 * Block an agent (defaults to the active partner) one-way and silently: add to
 * `blocked` and `no_resuggest`, with no envelope sent to the peer.
 */
export function blockAgent(tp: Transport, state: State, agentId?: string): Result {
  const target = agentId ?? state.active_chat?.partner.agent_id;
  if (!target) return { ok: false, message: "No target to block." };
  if (!state.blocked.includes(target)) state.blocked.push(target);
  if (!state.no_resuggest.includes(target)) state.no_resuggest.push(target);
  // If we're currently chatting with the blocked peer, tear that chat down too.
  if (state.active_chat && state.active_chat.partner.agent_id === target) {
    endChat(tp, state, false);
  }
  return { ok: true, message: `Blocked ${target} one-way and silently.` };
}

export function reportAgent(state: State, agentId: string, reason: string): Result {
  state.reports.push({ agent_id: agentId, reason: reason || "unspecified", at: nowIso() });
  if (!state.no_resuggest.includes(agentId)) state.no_resuggest.push(agentId);
  return { ok: true, message: `Reported ${agentId} (reason: ${reason || "not provided"}). They will be excluded from future recommendations.` };
}

// --- Inbound ingest ---------------------------------------------------------

/**
 * Resolve the sign-public-key the envelope must be verified against, derived from
 * trusted local state rather than the envelope itself. For an `intro` the key
 * comes from the self-describing sender_identity; for replies it must match the
 * peer recorded in the relevant outbox_intro / active_chat. Returns null when the
 * envelope does not correspond to an expected conversation/sender.
 */
function expectedSenderSignPub(state: State, env: Envelope): string | null {
  switch (env.type) {
    case "intro": {
      const si = env.sender_identity;
      if (!si) return null;
      // The claimed identity must match the envelope's `from`; the caller also
      // re-derives agent_id from sign_pub when validating the profile card.
      if (si.agent_id !== env.from) return null;
      return si.sign_pub;
    }
    case "intro_accept":
    case "intro_decline": {
      const ob = state.outbox_intro;
      if (!ob || ob.conversation_id !== env.conversation_id) return null;
      if (ob.peer.agent_id !== env.from) return null;
      return ob.peer.sign_pub;
    }
    case "message":
    case "end": {
      const chat = state.active_chat;
      if (!chat || chat.conversation_id !== env.conversation_id) return null;
      if (chat.partner.agent_id !== env.from) return null;
      return chat.partner.sign_pub;
    }
    default:
      return null;
  }
}

/**
 * Poll the transport for envelopes addressed to us and ingest them. Each is
 * deduplicated (seen_env), checked for correct recipient and non-blocked sender,
 * then signature-verified against expectedSenderSignPub before being applied.
 * Returns counts of ingested/rejected envelopes plus per-event labels.
 */
export function pollAndIngest(tp: Transport, state: State, collect?: ChannelCollector, ackSink?: string[]): IngestResult {
  const result: IngestResult = { ingested: 0, rejected: 0, events: [] };
  if (!state.identity) return result;
  const me = state.identity.agent_id;

  for (const { env, ref } of tp.pollEnvelopes(me)) {
    // When an ackSink is provided, defer the relay delete to the caller so it happens
    // only after local state is durably saved (persist-before-acknowledge, rob-01).
    const drop = () => {
      if (ackSink) ackSink.push(ref);
      else tp.deleteEnvelope(ref);
    };

    // Replay guard: skip (and ack) envelopes we've already processed.
    if (state.seen_env.includes(env.id)) {
      drop();
      continue;
    }
    // Drop anything not addressed to us (relay may hand back misrouted items).
    if (env.to !== me) {
      result.rejected++;
      markSeen(state, env.id);
      drop();
      continue;
    }
    // Silently discard envelopes from blocked senders without counting them as rejected.
    if (state.blocked.includes(env.from)) {
      markSeen(state, env.id);
      drop();
      continue;
    }
    // Verify the Ed25519 signature against the key expected for this conversation;
    // reject if no expected sender resolves or the signature is invalid.
    const signPub = expectedSenderSignPub(state, env);
    if (!signPub || !verifyEnvelope(env, signPub)) {
      result.rejected++;
      markSeen(state, env.id);
      drop();
      continue;
    }

    const handled = handleEnvelope(state, env, signPub, collect);
    if (handled) {
      result.ingested++;
      result.events.push(handled);
    } else {
      result.rejected++;
    }
    markSeen(state, env.id);
    drop();
  }
  return result;
}

function handleEnvelope(state: State, env: Envelope, signPub: string, collect?: ChannelCollector): string | null {
  switch (env.type) {
    case "intro": {
      const card = env.sender_profile;
      if (!card || !verifyCard(card).ok) return null; // reject invalid signed/expired profiles
      if (card.owner !== env.from || card.sign_pub !== signPub) return null; // card owner/key binding
      if (env.from === state.identity!.agent_id) return null; // ignore self-intro
      // Deduplicate by conversation: ignore an intro whose conversation is already
      // active, pending outbound, archived, in the inbox, or previously seen.
      const conv = env.conversation_id;
      if (
        state.active_chat?.conversation_id === conv ||
        state.outbox_intro?.conversation_id === conv ||
        state.past_chats.some((c) => c.conversation_id === conv) ||
        state.inbox_intros.some((i) => i.conversation_id === conv) ||
        (state.seen_conversations ?? []).includes(conv)
      ) {
        return null;
      }
      // Decrypt the optional first message with the sender's box key; on any
      // decrypt failure, treat the intro as having no first message rather than rejecting it.
      const peer = identityFromCard(card);
      let firstMessage: string | undefined;
      if (env.body) {
        try {
          firstMessage = decryptFrom(env.body, card.box_pub, state.identity!);
        } catch {
          firstMessage = undefined;
        }
      }
      const fmSan = firstMessage ? sanitizeIncoming(firstMessage) : undefined;
      // FIFO-cap the inbox; record the conversation as seen so an evicted intro cannot be
      // re-admitted as a fresh unread by a duplicate envelope (core-02).
      if (state.inbox_intros.length >= INBOX_INTRO_CAP) state.inbox_intros.shift();
      const alias = card.display_name ?? env.from;
      const rec: IntroRecord = {
        intro_id: newId("intro"),
        conversation_id: conv,
        peer,
        to: env.to,
        profile: card,
        ...(fmSan ? { first_message: fmSan.text } : {}),
        created_at: nowIso(),
        status: "pending",
        direction: "in",
      };
      state.inbox_intros.push(rec);
      markConversation(state, conv);
      setNotify(state, "intro", env.from, alias, true);
      collect?.({
        kind: "intro",
        from: env.from,
        alias,
        chat_id: conv,
        ts: nowIso(),
        text: fmSan ? fmSan.text : null,
        flagged: fmSan?.flagged ?? false,
        flags: fmSan?.flags ?? [],
      });
      return `intro:${env.from}`;
    }

    case "intro_accept": {
      const ob = state.outbox_intro;
      if (!ob || ob.conversation_id !== env.conversation_id) return null;
      if (state.active_chat) return null; // preserve 1:1 invariant
      const chat: Chat = {
        chat_id: ob.conversation_id,
        conversation_id: ob.conversation_id,
        partner: ob.peer,
        partner_profile: ob.profile,
        alias: null,
        status: "active",
        created_at: nowIso(),
        last_activity: nowIso(),
        messages: [],
      };
      if (ob.first_message) {
        pushMessage(chat, "out", state.identity!.agent_id, ob.first_message);
      }
      state.active_chat = chat;
      state.outbox_intro = null;
      const alias = ob.profile.display_name ?? env.from;
      setNotify(state, "accepted", env.from, alias, true);
      collect?.({ kind: "accepted", from: env.from, alias, chat_id: chat.conversation_id, ts: nowIso(), text: null, flagged: false, flags: [] });
      return `accepted:${env.from}`;
    }

    case "intro_decline": {
      const ob = state.outbox_intro;
      if (!ob || ob.conversation_id !== env.conversation_id) return null;
      const who = ob.profile.display_name ?? env.from;
      const conv = ob.conversation_id;
      state.outbox_intro = null;
      setNotify(state, "declined", env.from, who, true);
      collect?.({ kind: "declined", from: env.from, alias: who, chat_id: conv, ts: nowIso(), text: null, flagged: false, flags: [] });
      return `declined:${env.from}`;
    }

    case "message": {
      const chat = state.active_chat;
      if (!chat || chat.conversation_id !== env.conversation_id) return null;
      if (chat.partner.agent_id !== env.from) return null;
      if (!env.body) return null;
      let text: string;
      try {
        text = decryptFrom(env.body, chat.partner.box_pub, state.identity!);
      } catch {
        return null; // discard decrypt failures
      }
      const s = sanitizeIncoming(text);
      pushMessage(chat, "in", env.from, s.text, s.flagged, s.flags);
      const alias = chat.alias ?? chat.partner_profile.display_name ?? env.from;
      setNotify(state, "message", env.from, alias, true);
      collect?.({
        kind: "message",
        from: env.from,
        alias,
        chat_id: chat.conversation_id,
        ts: nowIso(),
        text: s.text,
        flagged: s.flagged,
        flags: s.flags,
      });
      return `message:${env.from}`;
    }

    case "end": {
      const chat = state.active_chat;
      if (!chat || chat.conversation_id !== env.conversation_id) return null;
      if (chat.partner.agent_id !== env.from) return null;
      chat.status = "ended";
      chat.ended_at = nowIso();
      if (!state.no_resuggest.includes(chat.partner.agent_id)) state.no_resuggest.push(chat.partner.agent_id);
      pushPastChat(state, chat);
      const who = chat.partner_profile.display_name ?? env.from;
      const conv = chat.conversation_id;
      state.active_chat = null;
      setNotify(state, "ended", env.from, who, true);
      collect?.({ kind: "ended", from: env.from, alias: who, chat_id: conv, ts: nowIso(), text: null, flagged: false, flags: [] });
      return `ended:${env.from}`;
    }

    default:
      return null;
  }
}

/** True when the active chat has been idle for at least `settings.cold_days` days. */
export function coldCheck(state: State, now: Date = new Date()): boolean {
  const chat = state.active_chat;
  if (!chat) return false;
  const last = Date.parse(chat.last_activity);
  if (Number.isNaN(last)) return false;
  const days = (now.getTime() - last) / (24 * 60 * 60 * 1000);
  return days >= state.settings.cold_days;
}
