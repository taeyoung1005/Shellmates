// 프로필 카드 빌드/서명/검증.
import { agentIdFromSignPub, signBytes, verifyBytes } from "./crypto.js";
import type { Identity, ProfileAnswers, ProfileCard } from "./types.js";
import { PROTOCOL_VERSION } from "./types.js";
import { addDaysIso, canonicalize, isExpired, nowIso } from "./util.js";

const DEFAULT_TTL_DAYS = 7;

/** 채워진 필드 수에 따라 성향 신뢰도 추정(0.4..0.92) */
function estimateConfidence(a: ProfileAnswers): number {
  let filled = 0;
  const total = 6;
  if (a.country) filled++;
  if (a.languages?.length) filled++;
  if (a.stacks?.length) filled++;
  if (a.interests?.length) filled++;
  if (a.communication_style) filled++;
  if (a.activity_hours) filled++;
  return Math.round((0.4 + 0.52 * (filled / total)) * 100) / 100;
}

/** 온보딩 답변 → 서명 전 프로필 카드 초안 */
export function buildProfile(identity: Identity, a: ProfileAnswers): ProfileCard {
  return {
    type: "profile_card",
    version: PROTOCOL_VERSION,
    owner: identity.agent_id,
    sign_pub: identity.sign_pub,
    box_pub: identity.box_pub,
    ...(a.display_name ? { display_name: a.display_name } : {}),
    country: a.country,
    languages: a.languages ?? [],
    stacks: a.stacks ?? [],
    interests: a.interests ?? [],
    communication_style: a.communication_style ?? "direct, logical",
    matching_modes: a.matching_modes ?? ["dating", "builder", "friend"],
    ...(a.activity_hours ? { activity_hours: a.activity_hours } : {}),
    ...(a.long_form !== undefined ? { long_form: a.long_form } : {}),
    ...(a.home_relay ? { home_relay: a.home_relay } : {}),
    profile_confidence: estimateConfidence(a),
    created_at: nowIso(),
    expires_at: addDaysIso(DEFAULT_TTL_DAYS),
    proofs: [],
  };
}

function cardSigningPayload(card: ProfileCard): string {
  const { signature, ...rest } = card;
  void signature;
  return canonicalize(rest);
}

/** 프로필 카드에 Ed25519 서명 부여 */
export function signProfile(identity: Identity, card: ProfileCard): ProfileCard {
  const unsigned: ProfileCard = { ...card, signature: undefined };
  // 항상 신원과 owner/공개키를 일치시킨다
  unsigned.owner = identity.agent_id;
  unsigned.sign_pub = identity.sign_pub;
  unsigned.box_pub = identity.box_pub;
  const sig = signPayload(unsigned, identity);
  return { ...unsigned, signature: sig };
}

function signPayload(card: ProfileCard, identity: Identity): string {
  return signBytes(cardSigningPayload(card), identity);
}

/** 카드 만료 시각 갱신(연장) */
export function renewProfile(identity: Identity, card: ProfileCard, days = DEFAULT_TTL_DAYS): ProfileCard {
  return signProfile(identity, { ...card, created_at: nowIso(), expires_at: addDaysIso(days) });
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/** 카드 검증: 서명 + owner=fingerprint(sign_pub) 바인딩 + 만료. */
export function verifyCard(card: ProfileCard, now: Date = new Date()): VerifyResult {
  if (!card || card.type !== "profile_card") return { ok: false, reason: "not_a_card" };
  if (!card.signature) return { ok: false, reason: "no_signature" };
  if (!card.sign_pub || !card.owner) return { ok: false, reason: "missing_identity" };
  // 적대/버그 카드 방어: 비문자열 키/소유자는 즉시 거부(아래 crypto 호출이 throw하지 않도록)
  if (typeof card.sign_pub !== "string" || typeof card.owner !== "string") return { ok: false, reason: "missing_identity" };
  if (agentIdFromSignPub(card.sign_pub) !== card.owner) return { ok: false, reason: "owner_binding_mismatch" };
  // 매칭에 쓰이는 필드의 타입을 검증(직접 서명한 악성 카드가 rankMatches/jaccard를 throw시켜
  // 피해자의 scan 전체를 무력화하는 것을 방지 — 서명만으로는 막을 수 없음).
  if (
    !Array.isArray(card.languages) ||
    !Array.isArray(card.stacks) ||
    !Array.isArray(card.interests) ||
    !Array.isArray(card.matching_modes) ||
    typeof card.communication_style !== "string" ||
    typeof card.country !== "string"
  ) {
    return { ok: false, reason: "bad_fields" };
  }
  if (!verifyBytes(cardSigningPayload(card), card.signature, card.sign_pub)) {
    return { ok: false, reason: "bad_signature" };
  }
  if (isExpired(card.expires_at, now)) return { ok: false, reason: "expired" };
  return { ok: true };
}
