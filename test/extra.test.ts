import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { redactForJson } from "../src/cli/cli.js";
import { resolveCtx } from "../src/core/config.js";
import { generateIdentity } from "../src/core/crypto.js";
import { lookupCard } from "../src/core/directory.js";
import { sendEnvelope } from "../src/core/relay.js";
import { PROTOCOL_VERSION, type Envelope } from "../src/core/types.js";
import { ALICE, engineFor, tempRoot } from "./helpers.js";

test("export-profile → import-profile makes it discoverable in scan", () => {
  const root = tempRoot();
  const out = join(root, "alice-card.json");
  const a = engineFor(join(root, "a"), join(root, "neta"));
  a.init();
  a.makeProfile(ALICE);
  a.publish();
  const ex = a.exportProfile(out);
  assert.ok(ex.ok && existsSync(out));

  // 다른 네트워크의 Bob이 Alice의 카드를 import
  const net2 = join(root, "netb");
  const b = engineFor(join(root, "b"), net2);
  b.init();
  b.makeProfile({ ...ALICE, display_name: "Bob", interests: ["AI Products"] });
  b.publish();
  assert.ok(b.importProfile(out).ok);
  const found = b.scan().matches.find((m) => m.card.owner === ex.card!.owner);
  assert.ok(found, "imported profile should appear in scan");
});

test("backup-key → import-key restores the same identity", () => {
  const root = tempRoot();
  const out = join(root, "key.json");
  const a = engineFor(join(root, "a"), join(root, "net"));
  const aid = a.init().agent_id!;
  assert.ok(a.backupKey(out).ok && existsSync(out));
  const fresh = engineFor(join(root, "b"), join(root, "net"));
  assert.equal(fresh.importKey(out).agent_id, aid);
});

test("rotate-key changes agent_id and resets profile", () => {
  const root = tempRoot();
  const a = engineFor(join(root, "a"), join(root, "net"));
  const old = a.init().agent_id!;
  a.makeProfile(ALICE);
  a.publish();
  const r = a.rotateKey();
  assert.ok(r.agent_id && r.agent_id !== old);
  assert.equal(a.getProfile(), null);
});

test("invite returns a link only when published", () => {
  const root = tempRoot();
  const a = engineFor(join(root, "a"), join(root, "net"));
  a.init();
  assert.equal(a.invite().ok, false); // not published
  a.makeProfile(ALICE);
  a.publish();
  const inv = a.invite();
  assert.ok(inv.ok && inv.link?.startsWith("terminallove://profile/agent_"));
});

test("path traversal agent_id rejected: lookup null + relay throws", () => {
  const root = tempRoot();
  const ctx = resolveCtx({ TL_HOME: join(root, "a"), TL_NET: join(root, "net") } as NodeJS.ProcessEnv);
  assert.equal(lookupCard(ctx, "../../etc/passwd"), null);
  const adv = generateIdentity();
  const bad: Envelope = {
    type: "message",
    v: PROTOCOL_VERSION,
    id: "env_deadbeefdeadbeef",
    from: adv.agent_id,
    to: "../../evil",
    conversation_id: "chat_x",
    created_at: new Date().toISOString(),
    nonce: "n",
  };
  assert.throws(() => sendEnvelope(ctx, bad));
});

test("redactForJson strips bodies/coaching/first_message by default", () => {
  const sample = {
    ok: true,
    chat: { partner: { agent_id: "agent_0000000000000000" }, messages: [{ text: "secret body" }] },
    coaching: { suggested_reply: "private advice" },
    intros: [{ intro_id: "i", first_message: "hi secret" }],
  };
  const red = JSON.stringify(redactForJson(sample, false));
  assert.ok(!red.includes("secret body"));
  assert.ok(!red.includes("private advice"));
  assert.ok(!red.includes("hi secret"));
  const full = JSON.stringify(redactForJson(sample, true));
  assert.ok(full.includes("secret body") && full.includes("private advice"));
});
