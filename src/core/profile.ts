// Internal implementation note.
import { agentIdFromSignPub, signBytes, verifyBytes } from "./crypto.js";
import type { Identity, ProfileAnswers, ProfileCard } from "./types.js";
import { PROTOCOL_VERSION } from "./types.js";
import { addDaysIso, canonicalize, isExpired, nowIso } from "./util.js";

const DEFAULT_TTL_DAYS = 7;

/** Internal implementation note. */
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

/** Internal implementation note. */
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

/** Internal implementation note. */
export function signProfile(identity: Identity, card: ProfileCard): ProfileCard {
  const unsigned: ProfileCard = { ...card, signature: undefined };
  // Internal implementation note.
  unsigned.owner = identity.agent_id;
  unsigned.sign_pub = identity.sign_pub;
  unsigned.box_pub = identity.box_pub;
  const sig = signPayload(unsigned, identity);
  return { ...unsigned, signature: sig };
}

function signPayload(card: ProfileCard, identity: Identity): string {
  return signBytes(cardSigningPayload(card), identity);
}

/** Internal implementation note. */
export function renewProfile(identity: Identity, card: ProfileCard, days = DEFAULT_TTL_DAYS): ProfileCard {
  return signProfile(identity, { ...card, created_at: nowIso(), expires_at: addDaysIso(days) });
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/** Internal implementation note. */
export function verifyCard(card: ProfileCard, now: Date = new Date()): VerifyResult {
  if (!card || card.type !== "profile_card") return { ok: false, reason: "not_a_card" };
  if (!card.signature) return { ok: false, reason: "no_signature" };
  if (!card.sign_pub || !card.owner) return { ok: false, reason: "missing_identity" };
  // Internal implementation note.
  if (typeof card.sign_pub !== "string" || typeof card.owner !== "string") return { ok: false, reason: "missing_identity" };
  if (agentIdFromSignPub(card.sign_pub) !== card.owner) return { ok: false, reason: "owner_binding_mismatch" };
  // Internal implementation note.
  // Internal implementation note.
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
