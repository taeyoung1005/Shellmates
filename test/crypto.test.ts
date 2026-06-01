import test from "node:test";
import assert from "node:assert/strict";
import {
  agentIdFromSignPub,
  decryptFrom,
  encryptFor,
  generateIdentity,
  signBytes,
  signEnvelope,
  verifyBytes,
  verifyEnvelope,
} from "../src/core/crypto.js";
import { PROTOCOL_VERSION, type Envelope } from "../src/core/types.js";
import { newId, newNonce, nowIso } from "../src/core/util.js";

test("agent_id = fingerprint(sign_pub)", () => {
  const id = generateIdentity();
  assert.equal(id.agent_id, agentIdFromSignPub(id.sign_pub));
  assert.match(id.agent_id, /^agent_[0-9a-f]{16}$/);
});

test("sign/verify roundtrip + tamper detection", () => {
  const id = generateIdentity();
  const sig = signBytes("hello world", id);
  assert.ok(verifyBytes("hello world", sig, id.sign_pub));
  assert.ok(!verifyBytes("hello world!", sig, id.sign_pub));
  const other = generateIdentity();
  assert.ok(!verifyBytes("hello world", sig, other.sign_pub));
});

test("E2E encrypt/decrypt roundtrip (X25519+AES-GCM)", () => {
  const a = generateIdentity();
  const b = generateIdentity();
  const blob = encryptFor("secret message 한글", b.box_pub, a);
  const pt = decryptFrom(blob, a.box_pub, b);
  assert.equal(pt, "secret message 한글");
});

test("decrypt fails for wrong recipient / tampered ciphertext", () => {
  const a = generateIdentity();
  const b = generateIdentity();
  const c = generateIdentity();
  const blob = encryptFor("secret", b.box_pub, a);
  assert.throws(() => decryptFrom(blob, a.box_pub, c));
  const tampered = { ...blob, ct: Buffer.from("garbage").toString("base64url") };
  assert.throws(() => decryptFrom(tampered, a.box_pub, b));
});

test("envelope sign/verify + binding (impersonation blocked)", () => {
  const a = generateIdentity();
  const base: Envelope = {
    type: "message",
    v: PROTOCOL_VERSION,
    id: newId("env"),
    from: a.agent_id,
    to: "agent_target0",
    conversation_id: newId("chat"),
    created_at: nowIso(),
    nonce: newNonce(),
  };
  const env = signEnvelope(base, a);
  assert.ok(verifyEnvelope(env, a.sign_pub));
  // 필드 변조 → 서명 불일치
  assert.ok(!verifyEnvelope({ ...env, to: "agent_other00" }, a.sign_pub));
  // from을 타인으로 주장하지만 a키로 서명 → 바인딩 불일치로 거부
  const spoof = signEnvelope({ ...base, from: "agent_deadbeef" }, a);
  assert.ok(!verifyEnvelope(spoof, a.sign_pub));
});
