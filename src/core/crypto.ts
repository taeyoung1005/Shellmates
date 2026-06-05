// Core crypto primitives for Shellmates identity, encrypted messaging, and
// signed-request auth: Ed25519 signatures, x25519 ECDH + HKDF + AES-256-GCM
// for 1:1 messages, scrypt + AES-256-GCM for passphrase-encrypted secrets,
// and canonicalized envelope/auth signing.
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
 * Derives the public agent_id from an Ed25519 sign public key: the first
 * 16 hex chars (64 bits) of its SHA-256 digest, prefixed "agent_".
 * Returns "agent_invalid" on non-string input or decode failure.
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

/** Generates a fresh identity: an Ed25519 sign keypair and an x25519 box keypair (raw JWK coordinates), with agent_id derived from the sign pubkey. */
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

// Rebuild Node KeyObjects from raw JWK base64url coordinates (x = pubkey, d = privkey scalar).
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

// Ed25519-sign the given bytes (strings are UTF-8 encoded) and return the signature as base64url.
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

// Compute the raw x25519 ECDH shared secret between my box keypair and their box pubkey.
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

// Passphrase-encrypted secret container: scrypt-derived key + AES-256-GCM.
// Used to encrypt locally-stored secrets (e.g. private keys) at rest.
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

// Canonical bytes signed for an envelope: every field except `signature`,
// canonicalized (sorted keys, undefined dropped) so signing is deterministic.
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
 * Verifies an envelope's signature. Requires a signature to be present and
 * checks that the sender's sign pubkey hashes to the envelope's `from`
 * agent_id (binding) before verifying the canonical payload.
 */
export function verifyEnvelope(env: Envelope, senderSignPub: string): boolean {
  if (!env.signature) return false;
  if (agentIdFromSignPub(senderSignPub) !== env.from) return false;
  return verifyBytes(envelopeSigningPayload(env), env.signature, senderSignPub);
}

// Signed-request auth scheme for the relay/directory server. Clients sign a
// canonical payload over (method, path, agent_id, ts, nonce); the server
// verifies the signature and rejects timestamps outside AUTH_SKEW_MS (2 min).
export const AUTH_SCHEME = "TL-Sig";
export const AUTH_VERSION = "0.1";
export const AUTH_SKEW_MS = 2 * 60 * 1000;

function authSigningPayload(method: string, path: string, agentId: string, ts: string, nonce: string): string {
  return canonicalize({ method: method.toUpperCase(), path, agent_id: agentId, ts, nonce });
}

/** Builds an Authorization header value signing (method, path, agent_id, fresh ts + nonce) and embedding the sign pubkey for verification. */
export function signAuth(identity: Identity, method: string, path: string): string {
  const ts = nowIso();
  const nonce = newNonce();
  const sig = signBytes(authSigningPayload(method, path, identity.agent_id, ts, nonce), identity);
  return `${AUTH_SCHEME} v=${AUTH_VERSION}, agent_id=${identity.agent_id}, pub=${identity.sign_pub}, ts=${ts}, nonce=${nonce}, sig=${sig}`;
}

/** Parses a "TL-Sig k=v, k=v, ..." Authorization header into a key/value map, or null if absent or not the expected scheme. */
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
 * Verifies a signed request: checks scheme/version, presence of all fields,
 * that the pubkey binds to the claimed agent_id, that ts is parseable and
 * within AUTH_SKEW_MS of `now`, and that the signature over the canonical
 * payload is valid. Returns the agent_id and nonce on success (nonce left to
 * the caller for replay tracking).
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
