// 암호 레이어 — Node 내장 crypto만 사용 (tweetnacl 대신, 동일 프리미티브·의존성 0).
//  - 신원/서명: Ed25519
//  - E2E 암호화: X25519 ECDH → HKDF-SHA256 → AES-256-GCM
//  - agent_id: Ed25519 공개키의 SHA-256 fingerprint
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  scryptSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";
import type { CipherBlob, Envelope, Identity, PublicIdentity } from "./types.js";
import { b64url, canonicalize, fromB64url, newNonce, nowIso } from "./util.js";

const HKDF_INFO = Buffer.from("shellmates-msg-v0.1");

/**
 * Ed25519 공개키 fingerprint → agent_id (16 hex = 64-bit, 충돌/사칭 저항).
 * 적대/버그 입력 방어: 비문자열/디코딩 불가 입력엔 throw 대신 "agent_invalid"(어떤 유효 id와도 불일치)를 반환한다.
 * → verifyEnvelope/verifyCard가 throw하지 않고 "거부"로 귀결되어, ingest/scan 트랜잭션이 깨지지 않음.
 */
export function agentIdFromSignPub(signPubB64: string): string {
  if (typeof signPubB64 !== "string") return "agent_invalid";
  try {
    const raw = fromB64url(signPubB64);
    const fp = createHash("sha256").update(raw).digest("hex").slice(0, 16);
    return `agent_${fp}`;
  } catch {
    return "agent_invalid";
  }
}

/** 새 신원(서명 + 암호화 키페어) 생성 */
export function generateIdentity(): Identity {
  const ed = generateKeyPairSync("ed25519");
  const x = generateKeyPairSync("x25519");
  const edPub = ed.publicKey.export({ format: "jwk" }) as { x: string };
  const edPriv = ed.privateKey.export({ format: "jwk" }) as { x: string; d: string };
  const xPub = x.publicKey.export({ format: "jwk" }) as { x: string };
  const xPriv = x.privateKey.export({ format: "jwk" }) as { x: string; d: string };

  const sign_pub = edPub.x;
  const agent_id = agentIdFromSignPub(sign_pub);
  return {
    agent_id,
    sign_pub,
    box_pub: xPub.x,
    sign_priv: edPriv.d,
    box_priv: xPriv.d,
    created_at: new Date().toISOString(),
  };
}

export function publicIdentity(id: Identity): PublicIdentity {
  return { agent_id: id.agent_id, sign_pub: id.sign_pub, box_pub: id.box_pub };
}

// ── KeyObject 복원 헬퍼 ─────────────────────────────────────────────
function edPublicKey(x: string): KeyObject {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
}
function edPrivateKey(x: string, d: string): KeyObject {
  return createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", x, d }, format: "jwk" });
}
function xPublicKey(x: string): KeyObject {
  return createPublicKey({ key: { kty: "OKP", crv: "X25519", x }, format: "jwk" });
}
function xPrivateKey(x: string, d: string): KeyObject {
  return createPrivateKey({ key: { kty: "OKP", crv: "X25519", x, d }, format: "jwk" });
}

// ── 서명/검증 ────────────────────────────────────────────────────────
export function signBytes(data: Buffer | string, identity: Identity): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  const key = edPrivateKey(identity.sign_pub, identity.sign_priv);
  return b64url(nodeSign(null, buf, key));
}

export function verifyBytes(data: Buffer | string, sigB64: string, signPubB64: string): boolean {
  try {
    const buf = typeof data === "string" ? Buffer.from(data) : data;
    const key = edPublicKey(signPubB64);
    return nodeVerify(null, buf, key, fromB64url(sigB64));
  } catch {
    return false;
  }
}

// ── E2E 암호화 (X25519 → HKDF → AES-256-GCM) ────────────────────────
function sharedSecret(myBoxPriv: string, myBoxPub: string, theirBoxPub: string): Buffer {
  const priv = xPrivateKey(myBoxPub, myBoxPriv);
  const pub = xPublicKey(theirBoxPub);
  return diffieHellman({ privateKey: priv, publicKey: pub });
}

export function encryptFor(
  plaintext: string,
  theirBoxPub: string,
  me: Identity,
): CipherBlob {
  const shared = sharedSecret(me.box_priv, me.box_pub, theirBoxPub);
  const salt = randomBytes(16);
  const key = Buffer.from(hkdfSync("sha256", shared, salt, HKDF_INFO, 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: "x25519-aesgcm",
    iv: b64url(iv),
    salt: b64url(salt),
    ct: b64url(ct),
    tag: b64url(tag),
  };
}

export function decryptFrom(blob: CipherBlob, theirBoxPub: string, me: Identity): string {
  const shared = sharedSecret(me.box_priv, me.box_pub, theirBoxPub);
  const key = Buffer.from(hkdfSync("sha256", shared, fromB64url(blob.salt), HKDF_INFO, 32));
  const decipher = createDecipheriv("aes-256-gcm", key, fromB64url(blob.iv));
  decipher.setAuthTag(fromB64url(blob.tag));
  const pt = Buffer.concat([decipher.update(fromB64url(blob.ct)), decipher.final()]);
  return pt.toString("utf8");
}

// ── 패스프레이즈 기반 시크릿 암호화 (키 백업용, PLAN §10) ─────────────────
// scrypt(passphrase) → AES-256-GCM. backup-key를 평문이 아닌 암호문으로 보관.
export interface SecretBox {
  v: "tl-secret-1";
  kdf: "scrypt";
  salt: string; // b64url
  iv: string;
  ct: string;
  tag: string;
}

export function isSecretBox(x: unknown): x is SecretBox {
  return !!x && typeof x === "object" && (x as { v?: string }).v === "tl-secret-1";
}

export function encryptWithPassphrase(plaintext: string, passphrase: string): SecretBox {
  const salt = randomBytes(16);
  const key = scryptSync(passphrase, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { v: "tl-secret-1", kdf: "scrypt", salt: b64url(salt), iv: b64url(iv), ct: b64url(ct), tag: b64url(cipher.getAuthTag()) };
}

export function decryptWithPassphrase(box: SecretBox, passphrase: string): string {
  const key = scryptSync(passphrase, fromB64url(box.salt), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, fromB64url(box.iv));
  decipher.setAuthTag(fromB64url(box.tag));
  return Buffer.concat([decipher.update(fromB64url(box.ct)), decipher.final()]).toString("utf8");
}

// ── 봉투 서명/검증 ────────────────────────────────────────────────────
function envelopeSigningPayload(env: Envelope): string {
  const { signature, ...rest } = env;
  void signature;
  return canonicalize(rest);
}

export function signEnvelope(env: Envelope, identity: Identity): Envelope {
  const signed: Envelope = { ...env, signature: undefined };
  signed.signature = signBytes(envelopeSigningPayload(signed), identity);
  return signed;
}

/**
 * 봉투 검증: 서명 유효성 + from == fingerprint(sign_pub) 바인딩까지 확인.
 * 클라이언트가 주장하는 from을 그대로 믿지 않고, 서명한 키로부터 agent_id를 재계산해 일치 여부를 강제한다.
 */
export function verifyEnvelope(env: Envelope, senderSignPub: string): boolean {
  if (!env.signature) return false;
  if (agentIdFromSignPub(senderSignPub) !== env.from) return false; // 사칭 방지(바인딩)
  return verifyBytes(envelopeSigningPayload(env), env.signature, senderSignPub);
}

// ── HTTP 요청 서명 인증 (TL-Sig) ─────────────────────────────────────
// 계정 없음. relay inbox 읽기/삭제는 "그 agent_id의 개인키 소유자"만 가능해야 한다(메타데이터 보호).
// 서명 대상: canonical({method, path, agent_id, ts, nonce}). 서버는 fingerprint(pub)==agent_id +
// 서명 유효 + ts 신선(±2분) + nonce 미사용(replay 캐시)을 확인한다.
export const AUTH_SCHEME = "TL-Sig";
export const AUTH_VERSION = "0.1";
export const AUTH_SKEW_MS = 2 * 60 * 1000;

function authSigningPayload(method: string, path: string, agentId: string, ts: string, nonce: string): string {
  return canonicalize({ method: method.toUpperCase(), path, agent_id: agentId, ts, nonce });
}

/** 인증 헤더 문자열 생성. `Authorization: <이 값>` 으로 전송. */
export function signAuth(identity: Identity, method: string, path: string): string {
  const ts = nowIso();
  const nonce = newNonce();
  const sig = signBytes(authSigningPayload(method, path, identity.agent_id, ts, nonce), identity);
  return `${AUTH_SCHEME} v=${AUTH_VERSION}, agent_id=${identity.agent_id}, pub=${identity.sign_pub}, ts=${ts}, nonce=${nonce}, sig=${sig}`;
}

/** `TL-Sig v=.., agent_id=.., pub=.., ts=.., nonce=.., sig=..` 헤더 파싱. 실패 시 null. */
export function parseAuthHeader(header: string | undefined): Record<string, string> | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.startsWith(AUTH_SCHEME)) return null;
  const rest = trimmed.slice(AUTH_SCHEME.length).trim();
  const out: Record<string, string> = {};
  for (const part of rest.split(",")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export interface AuthResult {
  ok: boolean;
  agentId?: string;
  nonce?: string;
  reason?: string;
}

/**
 * 인증 헤더 검증(서명 + agent_id 바인딩 + 버전 + ts 신선도).
 * nonce replay 캐시는 호출자(서버)가 반환된 nonce로 관리한다.
 */
export function verifyAuth(
  header: string | undefined,
  method: string,
  path: string,
  now: Date = new Date(),
): AuthResult {
  const parts = parseAuthHeader(header);
  if (!parts) return { ok: false, reason: "missing_or_bad_scheme" };
  if (parts.v !== AUTH_VERSION) return { ok: false, reason: "bad_version" };
  const { agent_id, pub, ts, nonce, sig } = parts;
  if (!agent_id || !pub || !ts || !nonce || !sig) return { ok: false, reason: "missing_fields" };
  if (agentIdFromSignPub(pub) !== agent_id) return { ok: false, reason: "binding_mismatch" };
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return { ok: false, reason: "bad_ts" };
  if (Math.abs(now.getTime() - t) > AUTH_SKEW_MS) return { ok: false, reason: "stale_ts" };
  if (!verifyBytes(authSigningPayload(method, path, agent_id, ts, nonce), sig, pub)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true, agentId: agent_id, nonce };
}
