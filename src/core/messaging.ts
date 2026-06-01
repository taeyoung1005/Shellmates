// 메시징 — intro → accept → 1:1 암호화 대화 + relay ingest(서명/바인딩/replay/미매칭 방어).
// 1:1 불변식: active_chat 0~1개, outbox_intro 0~1개.
// directory/relay 접근은 Transport 추상화 경유(LocalFs=공유폴더, Http=네트워크 서버).
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
  PublicIdentity,
  PublicProfileCard,
  State,
} from "./types.js";
import { PROTOCOL_VERSION } from "./types.js";
import { newId, newNonce, nowIso } from "./util.js";

const SEEN_CAP = 2000;

export interface Result {
  ok: boolean;
  message: string;
}

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
  chat.last_activity = msg.created_at;
  return msg;
}

// ── 발신 ─────────────────────────────────────────────────────────────

/** 소개 요청 전송 (1:1: active_chat·outbox_intro가 모두 없어야 함). */
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
  const fm = firstMessage ? firstMessage.slice(0, 2000) : undefined; // first-message length cap
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

/** 보낸 intro 취소 */
export function cancelIntro(state: State): Result {
  if (!state.outbox_intro) return { ok: false, message: "No pending intro." };
  const to = state.outbox_intro.to;
  state.outbox_intro = null;
  return { ok: true, message: `Canceled intro to ${to}.` };
}

/** 받은 intro 수락 → 1:1 대화 생성 + 상대에게 accept 통지 */
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

/** 받은 intro 거절 */
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

/** 현재 1:1 대화에 메시지 전송 */
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

/** 현재 대화 종료(언매치). block=true면 일방향 차단까지. */
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
  state.past_chats.push(chat);
  const who = chat.partner_profile.display_name ?? chat.partner.agent_id;
  state.active_chat = null;
  return { ok: true, message: block ? `Ended the chat with ${who} and blocked them.` : `Ended the chat with ${who}.` };
}

/** 일방향 차단(기본=현재 상대). 조용한 차단(상대에게 차단 사실 미통지). */
export function blockAgent(tp: Transport, state: State, agentId?: string): Result {
  const target = agentId ?? state.active_chat?.partner.agent_id;
  if (!target) return { ok: false, message: "No target to block." };
  if (!state.blocked.includes(target)) state.blocked.push(target);
  if (!state.no_resuggest.includes(target)) state.no_resuggest.push(target);
  // 현재 상대를 차단하면 대화도 정리(일반 end 통지만, '차단됨'은 알리지 않음)
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

// ── 수신 ingest ──────────────────────────────────────────────────────

/** 발신자 sign_pub 결정(타입별 신뢰 기준). 못 찾으면 null → 거부. */
function expectedSenderSignPub(state: State, env: Envelope): string | null {
  switch (env.type) {
    case "intro": {
      const si = env.sender_identity;
      if (!si) return null;
      // 봉투가 주장하는 from과 sender_identity의 일치 + 바인딩은 verifyEnvelope에서 재확인
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
 * relay inbox를 폴링해 검증된 봉투만 상태에 반영.
 * collect를 넘기면(채널 서버, 데이팅 세션 전용) 반영된 수신 항목을 본문 포함해 흘려보낸다.
 * 넘기지 않으면(데몬/thin MCP/CLI) 수집하지 않으므로 컨텍스트 방화벽이 보존된다.
 */
export function pollAndIngest(tp: Transport, state: State, collect?: ChannelCollector): IngestResult {
  const result: IngestResult = { ingested: 0, rejected: 0, events: [] };
  if (!state.identity) return result;
  const me = state.identity.agent_id;

  for (const { env, ref } of tp.pollEnvelopes(me)) {
    const drop = () => tp.deleteEnvelope(ref);

    // 1) 중복(replay) — 이미 처리한 id
    if (state.seen_env.includes(env.id)) {
      drop();
      continue;
    }
    // 2) 수신자 확인
    if (env.to !== me) {
      result.rejected++;
      markSeen(state, env.id);
      drop();
      continue;
    }
    // 3) 차단된 상대는 조용히 폐기
    if (state.blocked.includes(env.from)) {
      markSeen(state, env.id);
      drop();
      continue;
    }
    // 4) 발신자 키 결정 + 서명/바인딩 검증
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
      // conversation_id 충돌(기존 대화/intro 하이재킹) 방지
      const conv = env.conversation_id;
      if (
        state.active_chat?.conversation_id === conv ||
        state.outbox_intro?.conversation_id === conv ||
        state.past_chats.some((c) => c.conversation_id === conv) ||
        state.inbox_intros.some((i) => i.conversation_id === conv)
      ) {
        return null;
      }
      // 서명된 카드 기준으로 peer/box_pub 도출 (unsigned sender_identity의 키 치환 방지)
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
      // 스팸 방지: inbox 최대 50건 유지(초과 시 오래된 것 제거)
      if (state.inbox_intros.length >= 50) state.inbox_intros.shift();
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
      state.past_chats.push(chat);
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

/** cold 대화 자동 보관: 마지막 활동이 cold_days를 넘으면 종료 제안 신호만 남김(자동 end는 하지 않음). */
export function coldCheck(state: State, now: Date = new Date()): boolean {
  const chat = state.active_chat;
  if (!chat) return false;
  const last = Date.parse(chat.last_activity);
  if (Number.isNaN(last)) return false;
  const days = (now.getTime() - last) / (24 * 60 * 60 * 1000);
  return days >= state.settings.cold_days;
}
