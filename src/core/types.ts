// Internal implementation note.

export const PROTOCOL_VERSION = "0.1";

export type MatchingMode = "dating" | "builder" | "friend" | "founder";

/** Internal implementation note. */
export interface PublicIdentity {
  agent_id: string;
  sign_pub: string;
  box_pub: string;
}

/** Internal implementation note. */
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

/** Internal implementation note. */
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

/** Internal implementation note. */
export interface PresenceInfo {
  status: "online" | "recently_seen" | "offline";
  last_seen_at?: string;
  age_seconds?: number;
}

export type PublicProfileCard = ProfileCard & { presence?: PresenceInfo };

/** Internal implementation note. */
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

/** Internal implementation note. */
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

/** Internal implementation note. */
export interface Envelope {
  type: EnvelopeType;
  v: string;
  id: string;
  from: string;
  to: string;
  conversation_id: string;
  created_at: string;
  nonce: string;
  // Internal implementation note.
  sender_identity?: PublicIdentity;
  sender_profile?: PublicProfileCard;
  // Internal implementation note.
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
  // Internal implementation note.
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
  notifications: NotificationState;
  settings: Settings;
}

export interface MatchResult {
  card: PublicProfileCard;
  score: number; // 0..100
  reasons: string[];
}

/**
 * Internal implementation note.
 * Internal implementation note.
 * Internal implementation note.
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
