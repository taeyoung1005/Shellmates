// TerminalLove 프로토콜 공용 타입 정의.

export const PROTOCOL_VERSION = "0.1";

export type MatchingMode = "dating" | "builder" | "friend" | "founder";

/** 외부에 공개 가능한 신원 (서명/암호화 공개키 포함) */
export interface PublicIdentity {
  agent_id: string; // "agent_xxxxxxxx" (= sign_pub의 fingerprint)
  sign_pub: string; // Ed25519 공개키 (base64url raw 32B)
  box_pub: string; // X25519 공개키 (base64url raw 32B)
}

/** 로컬에만 저장되는 비밀 신원 */
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

/** 서명된 공개 프로필 카드 */
export interface ProfileCard {
  type: "profile_card";
  version: string;
  owner: string; // agent_id
  sign_pub: string; // 서명 검증 + agent_id 바인딩 확인용
  box_pub: string; // 타인이 owner에게 암호화할 때 사용
  display_name?: string;
  country: string;
  languages: string[];
  stacks: string[];
  interests: string[];
  communication_style: string;
  matching_modes: MatchingMode[];
  activity_hours?: string; // 예: "night" | "day" | "flexible"
  long_form?: boolean;
  profile_confidence: number; // 0..1
  created_at: string;
  expires_at: string;
  proofs: Proof[];
  signature?: string; // canonicalize(card without signature) 에 대한 Ed25519 서명
}

/** 디렉토리에서 가져온, 서명 검증을 거친 공개 카드 */
export type PublicProfileCard = ProfileCard;

/** 온보딩 답변 → 프로필 빌드 입력 */
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
}

/** 메시지 본문 암호화 봉투(payload) */
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

/** relay를 통해 전달되는 서명된 봉투 */
export interface Envelope {
  type: EnvelopeType;
  v: string;
  id: string; // env_xxx (replay/dedupe 키)
  from: string; // 발신 agent_id
  to: string; // 수신 agent_id
  conversation_id: string;
  created_at: string;
  nonce: string;
  // intro 전용: 발신자 신원 + 프로필 요약(수신자가 검증/표시/회신 암호화에 사용)
  sender_identity?: PublicIdentity;
  sender_profile?: PublicProfileCard;
  // intro/message 본문 암호문
  body?: CipherBlob;
  signature?: string; // canonicalize(envelope without signature) 에 대한 서명
}

export interface ChatMessage {
  msg_id: string;
  direction: "in" | "out";
  from: string; // agent_id
  text: string; // 평문 (로컬 전용)
  created_at: string;
  flagged?: boolean; // 인젝션/연락처 등 안전 플래그
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
  // inbox: 발신자 / outbox: 대상
  peer: PublicIdentity;
  to: string; // 수신 agent_id
  profile: PublicProfileCard;
  first_message?: string; // 평문(있으면)
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
  cold_days: number; // cold 대화 자동 보관 기준(일)
  default_modes: MatchingMode[];
}

export interface State {
  identity: Identity | null;
  profile: ProfileCard | null; // 서명된 내 프로필(또는 초안)
  published: boolean;
  active_chat: Chat | null; // 1:1 — 항상 0 또는 1개
  past_chats: Chat[];
  inbox_intros: IntroRecord[];
  outbox_intro: IntroRecord | null; // 1:1 — pending outbox도 0 또는 1개
  blocked: string[]; // 내가 일방향 차단한 agent_id
  no_resuggest: string[]; // 종료/거절로 재추천 제외할 agent_id
  reports: { agent_id: string; reason: string; at: string }[];
  seen_env: string[]; // 처리한 envelope id (replay/dedupe)
  notifications: NotificationState;
  settings: Settings;
}

export interface MatchResult {
  card: PublicProfileCard;
  score: number; // 0..100
  reasons: string[];
}

export interface CoachingPayload {
  partner_alias: string;
  partner_interests: string[];
  last_incoming?: string;
  guidance: string[];
  suggested_reply: string;
  warnings: string[];
}
