// 메시징 — intro → accept → 1:1 암호화 대화 + relay ingest(서명/바인딩/replay/미매칭 방어).
// 1:1 불변식: active_chat 0~1개, outbox_intro 0~1개.
import type { Ctx } from "./config.js";
import {
  agentIdFromSignPub,
  decryptFrom,
  encryptFor,
  publicIdentity,
  signEnvelope,
  verifyEnvelope,
} from "./crypto.js";
import { lookupCard } from "./directory.js";
import { verifyCard } from "./profile.js";
import { deleteEnvelope, pollEnvelopes, sendEnvelope } from "./relay.js";
import { sanitizeIncoming } from "./safety.js";
import type {
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
export function sendIntro(ctx: Ctx, state: State, targetAgentId: string, firstMessage?: string): Result {
  if (!state.identity) return { ok: false, message: "init이 필요합니다 (/dating init)." };
  if (!state.profile?.signature) return { ok: false, message: "프로필을 먼저 만들고 게시하세요 (/dating profile, /dating publish)." };
  if (targetAgentId === state.identity.agent_id) return { ok: false, message: "자기 자신에게는 intro할 수 없습니다." };
  if (state.blocked.includes(targetAgentId)) return { ok: false, message: "차단한 상대입니다." };
  if (state.active_chat) {
    return { ok: false, message: `이미 ${aliasOf(state, state.active_chat.partner.agent_id, state.active_chat.partner_profile.display_name)}와 1:1 대화 중입니다. 새 사람과 매칭하려면 먼저 종료하세요: /dating end` };
  }
  if (state.outbox_intro) {
    return { ok: false, message: "이미 보낸 intro가 응답 대기 중입니다. 한 번에 하나만 가능합니다 (/dating cancel 로 취소)." };
  }

  const card = lookupCard(ctx, targetAgentId);
  if (!card) return { ok: false, message: "디렉토리에서 대상을 찾을 수 없습니다(미게시/만료/오류)." };

  const conversation_id = newId("chat");
  const me = state.identity;
  const fm = firstMessage ? firstMessage.slice(0, 2000) : undefined; // 첫 메시지 길이 캡
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
  sendEnvelope(ctx, signEnvelope(env, me));

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
  return { ok: true, message: `intro 전송 완료 → ${targetAgentId}. 상대가 수락하면 1:1 대화가 열립니다.` };
}

/** 보낸 intro 취소 */
export function cancelIntro(ctx: Ctx, state: State): Result {
  void ctx;
  if (!state.outbox_intro) return { ok: false, message: "대기 중인 intro가 없습니다." };
  const to = state.outbox_intro.to;
  state.outbox_intro = null;
  return { ok: true, message: `${to}에게 보낸 intro를 취소했습니다.` };
}

/** 받은 intro 수락 → 1:1 대화 생성 + 상대에게 accept 통지 */
export function acceptIntro(ctx: Ctx, state: State, introId: string): Result {
  if (!state.identity) return { ok: false, message: "init이 필요합니다." };
  if (state.active_chat) return { ok: false, message: "이미 1:1 대화 중입니다. 먼저 종료하세요 (/dating end)." };
  const intro = state.inbox_intros.find((i) => i.intro_id === introId || i.conversation_id === introId);
  if (!intro) return { ok: false, message: "해당 intro를 찾을 수 없습니다." };

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
  sendEnvelope(ctx, signEnvelope(env, me));

  state.active_chat = chat;
  state.inbox_intros = state.inbox_intros.filter((i) => i.intro_id !== intro.intro_id);
  return { ok: true, message: `intro 수락 — ${intro.profile.display_name ?? intro.peer.agent_id}와 1:1 대화가 열렸습니다.` };
}

/** 받은 intro 거절 */
export function declineIntro(ctx: Ctx, state: State, introId: string): Result {
  if (!state.identity) return { ok: false, message: "init이 필요합니다." };
  const intro = state.inbox_intros.find((i) => i.intro_id === introId || i.conversation_id === introId);
  if (!intro) return { ok: false, message: "해당 intro를 찾을 수 없습니다." };
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
  sendEnvelope(ctx, signEnvelope(env, state.identity));
  state.inbox_intros = state.inbox_intros.filter((i) => i.intro_id !== intro.intro_id);
  return { ok: true, message: "intro를 거절했습니다." };
}

/** 현재 1:1 대화에 메시지 전송 */
export function sendMessage(ctx: Ctx, state: State, text: string): Result {
  if (!state.identity) return { ok: false, message: "init이 필요합니다." };
  const chat = state.active_chat;
  if (!chat || chat.status !== "active") return { ok: false, message: "열린 대화가 없습니다. 먼저 intro/accept 하세요." };
  if (!text.trim()) return { ok: false, message: "빈 메시지는 보낼 수 없습니다." };

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
  sendEnvelope(ctx, signEnvelope(env, me));
  pushMessage(chat, "out", me.agent_id, text);
  return { ok: true, message: "전송됨." };
}

/** 현재 대화 종료(언매치). block=true면 일방향 차단까지. */
export function endChat(ctx: Ctx, state: State, block = false): Result {
  if (!state.identity) return { ok: false, message: "init이 필요합니다." };
  const chat = state.active_chat;
  if (!chat) return { ok: false, message: "종료할 대화가 없습니다." };

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
  sendEnvelope(ctx, signEnvelope(env, state.identity));

  chat.status = "ended";
  chat.ended_at = nowIso();
  if (!state.no_resuggest.includes(chat.partner.agent_id)) state.no_resuggest.push(chat.partner.agent_id);
  if (block && !state.blocked.includes(chat.partner.agent_id)) state.blocked.push(chat.partner.agent_id);
  state.past_chats.push(chat);
  const who = chat.partner_profile.display_name ?? chat.partner.agent_id;
  state.active_chat = null;
  return { ok: true, message: block ? `${who}와의 대화를 종료하고 차단했습니다.` : `${who}와의 대화를 종료했습니다(언매치).` };
}

/** 일방향 차단(기본=현재 상대). 조용한 차단(상대에게 차단 사실 미통지). */
export function blockAgent(ctx: Ctx, state: State, agentId?: string): Result {
  const target = agentId ?? state.active_chat?.partner.agent_id;
  if (!target) return { ok: false, message: "차단할 대상이 없습니다." };
  if (!state.blocked.includes(target)) state.blocked.push(target);
  if (!state.no_resuggest.includes(target)) state.no_resuggest.push(target);
  // 현재 상대를 차단하면 대화도 정리(일반 end 통지만, '차단됨'은 알리지 않음)
  if (state.active_chat && state.active_chat.partner.agent_id === target) {
    endChat(ctx, state, false);
  }
  return { ok: true, message: `${target}를 차단했습니다(일방향, 조용한 차단).` };
}

export function reportAgent(state: State, agentId: string, reason: string): Result {
  state.reports.push({ agent_id: agentId, reason: reason || "unspecified", at: nowIso() });
  if (!state.no_resuggest.includes(agentId)) state.no_resuggest.push(agentId);
  return { ok: true, message: `${agentId}를 신고했습니다(사유: ${reason || "미기재"}). 재추천에서 제외됩니다.` };
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

/** relay inbox를 폴링해 검증된 봉투만 상태에 반영. */
export function pollAndIngest(ctx: Ctx, state: State): IngestResult {
  const result: IngestResult = { ingested: 0, rejected: 0, events: [] };
  if (!state.identity) return result;
  const me = state.identity.agent_id;

  for (const { env, path } of pollEnvelopes(ctx, me)) {
    const drop = () => deleteEnvelope(path);

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

    const handled = handleEnvelope(ctx, state, env, signPub);
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

function handleEnvelope(ctx: Ctx, state: State, env: Envelope, signPub: string): string | null {
  void ctx;
  switch (env.type) {
    case "intro": {
      const card = env.sender_profile;
      if (!card || !verifyCard(card).ok) return null; // 유효하지 않은(서명/만료) 프로필이면 거부
      if (card.owner !== env.from || card.sign_pub !== signPub) return null; // 카드 owner/키 바인딩
      if (env.from === state.identity!.agent_id) return null; // self-intro 무시
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
      // 스팸 방지: inbox 최대 50건 유지(초과 시 오래된 것 제거)
      if (state.inbox_intros.length >= 50) state.inbox_intros.shift();
      const rec: IntroRecord = {
        intro_id: newId("intro"),
        conversation_id: conv,
        peer,
        to: env.to,
        profile: card,
        ...(firstMessage ? { first_message: sanitizeIncoming(firstMessage).text } : {}),
        created_at: nowIso(),
        status: "pending",
        direction: "in",
      };
      state.inbox_intros.push(rec);
      setNotify(state, "intro", env.from, card.display_name ?? env.from, true);
      return `intro:${env.from}`;
    }

    case "intro_accept": {
      const ob = state.outbox_intro;
      if (!ob || ob.conversation_id !== env.conversation_id) return null;
      if (state.active_chat) return null; // 1:1 불변식 보호
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
      setNotify(state, "accepted", env.from, ob.profile.display_name ?? env.from, true);
      return `accepted:${env.from}`;
    }

    case "intro_decline": {
      const ob = state.outbox_intro;
      if (!ob || ob.conversation_id !== env.conversation_id) return null;
      const who = ob.profile.display_name ?? env.from;
      state.outbox_intro = null;
      setNotify(state, "declined", env.from, who, true);
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
        return null; // 복호화 실패 → 폐기
      }
      const s = sanitizeIncoming(text);
      pushMessage(chat, "in", env.from, s.text, s.flagged, s.flags);
      setNotify(state, "message", env.from, chat.alias ?? chat.partner_profile.display_name ?? env.from, true);
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
      state.active_chat = null;
      setNotify(state, "ended", env.from, who, true);
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
