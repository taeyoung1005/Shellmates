import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveCtx, type Ctx } from "../src/core/config.js";
import { encryptFor, generateIdentity, signEnvelope } from "../src/core/crypto.js";
import { sendEnvelope } from "../src/core/relay.js";
import { loadState } from "../src/core/store.js";
import { PROTOCOL_VERSION, type Envelope, type Identity } from "../src/core/types.js";
import { newId, newNonce, nowIso } from "../src/core/util.js";
import { ALICE, BOB, bringToChat, engineFor, pair } from "./helpers.js";

function ctxFor(home: string, net: string): Ctx {
  return resolveCtx({ TL_HOME: home, TL_NET: net } as NodeJS.ProcessEnv);
}
function identOf(home: string, net: string): Identity {
  return loadState(ctxFor(home, net)).identity!;
}
function msgEnvelope(from: string, to: string, conv: string, text: string, recipBoxPub: string, signer: Identity): Envelope {
  return signEnvelope(
    {
      type: "message",
      v: PROTOCOL_VERSION,
      id: newId("env"),
      from,
      to,
      conversation_id: conv,
      created_at: nowIso(),
      nonce: newNonce(),
      body: encryptFor(text, recipBoxPub, signer),
    },
    signer,
  );
}

test("happy path: intro → accept → 1:1 send/receive (E2E encrypted)", () => {
  const p = pair();
  const { aId, bId } = bringToChat(p, "Hi Bob!");
  const bChat = p.b.open().chat!;
  assert.ok(bChat.messages.some((m) => m.direction === "in" && m.text.includes("Hi Bob")));
  assert.ok(p.b.send("hello Alice").ok);
  const aChat = p.a.open().chat!;
  assert.equal(aChat.messages.at(-1)!.direction, "in");
  assert.equal(aChat.partner.agent_id, bId);
  assert.equal(bChat.partner.agent_id, aId);
});

test("1:1 invariant: cannot intro while a chat is active", () => {
  const p = pair();
  bringToChat(p);
  const other = generateIdentity();
  assert.equal(p.a.intro(other.agent_id, "hi").ok, false);
});

test("1:1 invariant: cannot have two pending outbox intros", () => {
  const p = pair();
  p.a.init();
  const bId = p.b.init().agent_id!;
  p.a.makeProfile(ALICE);
  p.a.publish();
  p.b.makeProfile(BOB);
  p.b.publish();
  assert.ok(p.a.intro(bId, "first").ok);
  assert.equal(p.a.intro(bId, "second").ok, false);
});

test("intro requires published profile of target", () => {
  const p = pair();
  p.a.init();
  p.a.makeProfile(ALICE);
  p.a.publish();
  const ghost = generateIdentity();
  assert.equal(p.a.intro(ghost.agent_id, "hi").ok, false);
});

test("security: forged-signature message is rejected", () => {
  const p = pair();
  const { aId, bId } = bringToChat(p, "hi");
  const conv = p.b.open().chat!.conversation_id;
  const attacker = generateIdentity();
  const bIdent = identOf(p.bHome, p.net);
  p.b.reload();
  const before = p.b.state.active_chat!.messages.length;
  // Internal implementation note.
  const forged = msgEnvelope(aId, bId, conv, "evil", bIdent.box_pub, attacker);
  sendEnvelope(ctxFor(p.bHome, p.net), forged);
  const ing = p.b.poll();
  assert.ok(ing.rejected >= 1);
  assert.equal(p.b.state.active_chat!.messages.length, before);
});

test("security: replay of same envelope is deduped", () => {
  const p = pair();
  const { aId, bId } = bringToChat(p, "hi");
  const conv = p.b.open().chat!.conversation_id;
  const aIdent = identOf(p.aHome, p.net);
  const bIdent = identOf(p.bHome, p.net);
  const env = msgEnvelope(aId, bId, conv, "replay-me", bIdent.box_pub, aIdent);
  const ctx = ctxFor(p.bHome, p.net);
  sendEnvelope(ctx, env);
  assert.equal(p.b.poll().ingested, 1);
  sendEnvelope(ctx, env);
  assert.equal(p.b.poll().ingested, 0);
});

test("security: message without an active match is rejected", () => {
  const p = pair();
  const { bId } = bringToChat(p, "hi");
  const attacker = generateIdentity();
  const bIdent = identOf(p.bHome, p.net);
  const env = msgEnvelope(attacker.agent_id, bId, newId("chat"), "hi", bIdent.box_pub, attacker);
  sendEnvelope(ctxFor(p.bHome, p.net), env);
  assert.ok(p.b.poll().rejected >= 1);
});

test("one-way block drops incoming intro from blocked agent", () => {
  const p = pair();
  const aId = p.a.init().agent_id!;
  p.a.makeProfile(ALICE);
  p.a.publish();
  const c = engineFor(join(p.root, "c"), p.net);
  const cId = c.init().agent_id!;
  c.makeProfile(BOB);
  c.publish();
  assert.ok(c.intro(aId, "hey").ok);
  p.a.block(cId);
  assert.equal(p.a.inbox().intros.length, 0);
});

test("end → unmatch + no_resuggest excludes partner from scan", () => {
  const p = pair();
  const { bId } = bringToChat(p, "hi");
  assert.ok(p.a.end().ok);
  // Internal implementation note.
  assert.equal(p.b.open().chat, null);
  const matches = p.a.scan().matches;
  assert.ok(!matches.some((m) => m.card.owner === bId));
});

test("decline removes intro and notifies introducer", () => {
  const p = pair();
  const aId = p.a.init().agent_id!;
  const bId = p.b.init().agent_id!;
  p.a.makeProfile(ALICE);
  p.a.publish();
  p.b.makeProfile(BOB);
  p.b.publish();
  p.a.intro(bId, "hi");
  const intro = p.b.inbox().intros[0]!;
  assert.ok(p.b.decline(intro.intro_id).ok);
  assert.equal(p.b.inbox().intros.length, 0);
  // Internal implementation note.
  p.a.poll();
  assert.ok(p.a.intro(bId, "again").ok);
  void aId;
});
