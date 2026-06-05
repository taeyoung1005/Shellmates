// Shared protocol/domain types for identity, profiles, envelopes, chat, and channel state.

export const PROTOCOL_VERSION = "0.1";

export type MatchingMode = "dating" | "builder" | "friend" | "founder";

/** Standard `{ ok, message }` result returned by engine/messaging operations. */
export interface OpResult {
  ok: boolean;
  message: string;
}

/** Shareable identity: agent_id (hash of sign_pub) plus the Ed25519 sign and x25519 box public keys. */
export interface PublicIdentity {
  agent_id: string;
  sign_pub: string;
  box_pub: string;
}

/** Full local identity: public keys plus the private Ed25519/x25519 key material (never shared). */
export interface Identity extends PublicIdentity {
  sign_priv: string; // Ed25519 private seed (base64url raw 32B)
  box_priv: string; // X25519 private scalar (base64url raw 32B)
  created_at: string;
}

export interface Proof {
  type: "github" | "domain";
  value: string;
  verified_at?: string;
}

/** Canonicalized, signed profile card published to the directory; signature covers all other fields. */
export interface ProfileCard {
  type: "profile_card";
  version: string;
  owner: string; // agent_id
  sign_pub: string;
  box_pub: string;
  display_name?: string;
  country: string;
  languages: string[];
  stacks: string[];
  interests: string[];
  communication_style: string;
  matching_modes: MatchingMode[];
  activity_hours?: string;
  long_form?: boolean;
  home_relay?: string;
  profile_confidence: number; // 0..1
  created_at: string;
  expires_at: string;
  proofs: Proof[];
  signature?: string;
}

/** Liveness info derived from a peer's last-seen timestamp, attached to directory results. */
export interface PresenceInfo {
  status: "online" | "recently_seen" | "offline";
  last_seen_at?: string;
  age_seconds?: number;
}

export type PublicProfileCard = ProfileCard & { presence?: PresenceInfo };

/** Raw user-supplied profile inputs, before they are built into a signed ProfileCard. */
export interface ProfileAnswers {
  display_name?: string;
  country: string;
  languages: string[];
  stacks: string[];
  interests: string[];
  communication_style?: string;
  matching_modes?: MatchingMode[];
  activity_hours?: string;
  long_form?: boolean;
  home_relay?: string;
}

/** Encrypted payload: x25519 ECDH + HKDF-derived AES-256-GCM, with iv/salt/ciphertext/tag base64url-encoded. */
export interface CipherBlob {
  alg: "x25519-aesgcm";
  iv: string; // base64url
  salt: string; // base64url (HKDF salt)
  ct: string; // base64url ciphertext
  tag: string; // base64url GCM auth tag
}

export type EnvelopeType =
  | "intro"
  | "intro_accept"
  | "intro_decline"
  | "message"
  | "end";

/** Signed relay envelope; the signature covers the canonicalized envelope minus the signature field. */
export interface Envelope {
  type: EnvelopeType;
  v: string;
  id: string;
  from: string;
  to: string;
  conversation_id: string;
  created_at: string;
  nonce: string;
  // Sender's identity/profile, included on intro-type envelopes so the recipient can verify and display them.
  sender_identity?: PublicIdentity;
  sender_profile?: PublicProfileCard;
  // Encrypted message content; absent on control envelopes (e.g. decline/end) that carry no payload.
  body?: CipherBlob;
  signature?: string;
}

export interface ChatMessage {
  msg_id: string;
  direction: "in" | "out";
  from: string; // agent_id
  text: string;
  created_at: string;
  flagged?: boolean;
  flags?: string[];
}

export interface Chat {
  chat_id: string;
  conversation_id: string;
  partner: PublicIdentity;
  partner_profile: PublicProfileCard;
  alias: string | null;
  status: "active" | "ended";
  created_at: string;
  ended_at?: string;
  last_activity: string;
  messages: ChatMessage[];
}

export interface IntroRecord {
  intro_id: string;
  conversation_id: string;
  // The other party to the intro: the sender for inbound records, the target for outbound ones.
  peer: PublicIdentity;
  to: string;
  profile: PublicProfileCard;
  first_message?: string;
  created_at: string;
  status: "pending" | "accepted" | "declined";
  direction: "in" | "out";
}

export interface NotificationState {
  unread: number;
  last_from_alias: string | null;
  last_from_agent: string | null;
  last_event: string | null; // "message" | "intro" | "accepted" | "declined" | "ended"
  updated_at: string | null;
}

export interface Settings {
  cold_days: number;
  default_modes: MatchingMode[];
}

export interface State {
  identity: Identity | null;
  profile: ProfileCard | null;
  published: boolean;
  active_chat: Chat | null;
  past_chats: Chat[];
  inbox_intros: IntroRecord[];
  outbox_intro: IntroRecord | null;
  blocked: string[];
  no_resuggest: string[];
  reports: { agent_id: string; reason: string; at: string }[];
  seen_env: string[];
  // conversation_ids of intros already admitted, so an intro evicted from the 50-slot
  // inbox cannot be re-admitted as a fresh unread on a duplicate envelope.
  seen_conversations: string[];
  notifications: NotificationState;
  settings: Settings;
}

export interface MatchResult {
  card: PublicProfileCard;
  score: number; // 0..100
  reasons: string[];
}

/**
 * A single normalized event surfaced on the live channel feed (intro, accept,
 * decline, message, or end). `text` holds decrypted message content when present,
 * and `flagged`/`flags` carry context-firewall results from sanitizing peer text.
 */
export interface ChannelItem {
  kind: "intro" | "accepted" | "declined" | "message" | "ended";
  from: string;
  alias: string;
  chat_id: string | null; // conversation_id
  ts: string;
  text: string | null;
  flagged: boolean;
  flags: string[];
}

export type ChannelCollector = (item: ChannelItem) => void;

export interface CoachingPayload {
  partner_alias: string;
  partner_interests: string[];
  last_incoming?: string;
  guidance: string[];
  reply_strategy: string;
  /** @deprecated Do not emit send-ready replies from coaching. */
  suggested_reply?: string;
  warnings: string[];
}
