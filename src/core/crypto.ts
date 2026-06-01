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
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";
import type { CipherBlob, Envelope, Identity, PublicIdentity } from "./types.js";
import { b64url, canonicalize, fromB64url } from "./util.js";

const HKDF_INFO = Buffer.from("terminallove-msg-v0.1");

/** Ed25519 공개키 fingerprint → agent_id (16 hex = 64-bit, 충돌/사칭 저항) */
export function agentIdFromSignPub(signPubB64: string): string {
  const raw = fromB64url(signPubB64);
  const fp = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `agent_${fp}`;
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
