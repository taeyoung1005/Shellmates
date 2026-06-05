// Internal implementation note.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCtx } from "../src/core/config.js";
import { generateIdentity } from "../src/core/crypto.js";
import { Engine } from "../src/core/engine.js";
import { HttpTransport } from "../src/core/transport-http.js";
import { LocalFsTransport } from "../src/core/transport-local.js";
import type { Transport, PolledEnvelope, DirectoryQuery } from "../src/core/transport.js";
import type { Envelope, PresenceInfo, ProfileCard, PublicProfileCard, State } from "../src/core/types.js";
import { ALICE, BOB, tempRoot } from "./helpers.js";

// Internal implementation note.
class ChaosTransport implements Transport {
  failSend = false;
  failScan = false;
  constructor(private readonly inner: Transport) {}
  publishCard(c: ProfileCard): void {
    this.inner.publishCard(c);
  }
  revokeCard(id: string): void {
    this.inner.revokeCard(id);
  }
  scanCards(now?: Date, q?: DirectoryQuery): PublicProfileCard[] {
    if (this.failScan) throw new Error("simulated hostile card crash in scanCards");
    return this.inner.scanCards(now, q);
  }
  lookupCard(id: string, now?: Date): PublicProfileCard | null {
    return this.inner.lookupCard(id, now);
  }
  sendEnvelope(env: Envelope): void {
    if (this.failSend) throw new Error("simulated server 429 on POST /relay");
    this.inner.sendEnvelope(env);
  }
  pollEnvelopes(me: string): PolledEnvelope[] {
    return this.inner.pollEnvelopes(me);
  }
  deleteEnvelope(ref: string): void {
    this.inner.deleteEnvelope(ref);
  }
  heartbeat(agentId: string): PresenceInfo | null {
    return this.inner.heartbeat(agentId);
  }
}

test("HIGH regression: inbound message ingested in send() survives a throwing send (no silent loss)", () => {
  const root = tempRoot();
  const net = join(root, "net");
  const aliceCtx = resolveCtx({ TL_HOME: join(root, "alice"), TL_NET: net } as NodeJS.ProcessEnv);
  const bobCtx = resolveCtx({ TL_HOME: join(root, "bob"), TL_NET: net } as NodeJS.ProcessEnv);

  const chaos = new ChaosTransport(new LocalFsTransport(aliceCtx));
  const alice = new Engine(aliceCtx, chaos);
  const bob = new Engine(bobCtx);

  // Internal implementation note.
  alice.init();
  const bId = bob.init().agent_id!;
  alice.makeProfile(ALICE);
  alice.publish();
  bob.makeProfile(BOB);
  bob.publish();
  assert.ok(alice.intro(bId, "hi bob").ok);
  const intro = bob.inbox().intros[0]!;
  assert.ok(bob.accept(intro.intro_id).ok);
  assert.ok(alice.open().chat, "alice active chat should open");

  // Internal implementation note.
  const MARK = "BOB_MSG_MUST_SURVIVE_42";
  assert.ok(bob.send(MARK).ok);

  // Internal implementation note.
  chaos.failSend = true;
  const r = alice.send("alice reply that won't go out");
  assert.equal(r.ok, false, "send should report failure");

  // Internal implementation note.
  alice.reload();
  const texts = (alice.state.active_chat?.messages ?? []).map((m) => m.text);
  assert.ok(texts.includes(MARK), `received message should survive. actual: ${JSON.stringify(texts)}`);

  // Internal implementation note.
  const again = alice.poll();
  assert.equal(again.ingested, 0, "already ingested message should not be received again because seen_env is durable");
});

test("rob-01: relay delete (ack) happens only after local state is durably persisted", () => {
  const root = tempRoot();
  const net = join(root, "net");
  const aliceCtx = resolveCtx({ TL_HOME: join(root, "alice"), TL_NET: net } as NodeJS.ProcessEnv);
  const bobCtx = resolveCtx({ TL_HOME: join(root, "bob"), TL_NET: net } as NodeJS.ProcessEnv);

  // Probe that, on each relay delete (ack), captures what is already persisted on disk.
  const inner = new LocalFsTransport(aliceCtx);
  const probeState: { textsAtAck: string[] | null } = { textsAtAck: null };
  const probe: Transport = {
    publishCard: (c) => inner.publishCard(c),
    revokeCard: (id) => inner.revokeCard(id),
    scanCards: (now, q) => inner.scanCards(now, q),
    lookupCard: (id, now) => inner.lookupCard(id, now),
    sendEnvelope: (e) => inner.sendEnvelope(e),
    pollEnvelopes: (me) => inner.pollEnvelopes(me),
    heartbeat: (id) => inner.heartbeat(id),
    deleteEnvelope: (ref) => {
      if (probeState.textsAtAck === null) {
        const persisted = JSON.parse(readFileSync(aliceCtx.statePath, "utf8")) as State;
        probeState.textsAtAck = (persisted.active_chat?.messages ?? []).map((m) => m.text);
      }
      inner.deleteEnvelope(ref);
    },
  };
  const alice = new Engine(aliceCtx, probe);
  const bob = new Engine(bobCtx);

  alice.init();
  const bId = bob.init().agent_id!;
  alice.makeProfile(ALICE);
  alice.publish();
  bob.makeProfile(BOB);
  bob.publish();
  assert.ok(alice.intro(bId, "hi bob").ok);
  const intro = bob.inbox().intros[0]!;
  assert.ok(bob.accept(intro.intro_id).ok);
  assert.ok(alice.open().chat, "alice chat should open");

  const MARK = "ACK_AFTER_SAVE_MARK";
  assert.ok(bob.send(MARK).ok);
  probeState.textsAtAck = null; // ignore acks from setup; capture the next one (for MARK)
  alice.poll();

  // `as` defeats the control-flow narrowing from the `= null` assignment above; alice.poll()
  // repopulates it via the probe's deleteEnvelope hook.
  const seen = probeState.textsAtAck as string[] | null;
  assert.ok(seen, "an ack delete should have occurred while ingesting MARK");
  assert.ok(seen.includes(MARK), "state must already be persisted with MARK at ack time (persist-before-ack)");
});

test("HIGH regression: scan() commits ingest before a throwing scanCards (no inbound intro loss)", () => {
  const root = tempRoot();
  const net = join(root, "net");
  const aliceCtx = resolveCtx({ TL_HOME: join(root, "alice"), TL_NET: net } as NodeJS.ProcessEnv);
  const chaos = new ChaosTransport(new LocalFsTransport(aliceCtx));
  const alice = new Engine(aliceCtx, chaos);
  const bob = new Engine(resolveCtx({ TL_HOME: join(root, "bob"), TL_NET: net } as NodeJS.ProcessEnv));

  alice.init();
  const aId = alice.agentId!;
  bob.init();
  alice.makeProfile(ALICE);
  alice.publish();
  bob.makeProfile(BOB);
  bob.publish();
  // Internal implementation note.
  assert.ok(bob.intro(aId, "hi from bob — must not be lost").ok);

  // Internal implementation note.
  chaos.failScan = true;
  const r = alice.scan();
  assert.equal(r.ok, false, "scan should report failure");
  assert.deepEqual(r.matches, [], "matches should be empty");

  // Internal implementation note.
  alice.reload();
  assert.equal(alice.state.inbox_intros.length, 1, "throwing scanCards must not lose the received intro");
});

test("availability: a peer's self-signed card with null array fields is rejected and does not break matching", async () => {
  const { signProfile, buildProfile, verifyCard } = await import("../src/core/profile.js");
  const { rankMatches } = await import("../src/core/matching.js");
  const mineId = generateIdentity();
  const evilId = generateIdentity();
  const mine = signProfile(mineId, buildProfile(mineId, ALICE));
  // Internal implementation note.
  const evilBase = buildProfile(evilId, BOB) as unknown as Record<string, unknown>;
  evilBase.interests = null;
  const evil = signProfile(evilId, evilBase as never);
  // Internal implementation note.
  assert.equal(verifyCard(evil).ok, false, "card with null array field should be rejected");
  // Internal implementation note.
  const good = signProfile(generateIdentity(), buildProfile(generateIdentity(), { ...BOB, display_name: "Good" }));
  assert.doesNotThrow(() => rankMatches(mine, [evil, good], { myAgentId: mineId.agent_id }));
});

test("hardening: verifyCard / agentIdFromSignPub tolerate non-string sign_pub (no throw)", async () => {
  const { verifyCard } = await import("../src/core/profile.js");
  const { agentIdFromSignPub } = await import("../src/core/crypto.js");
  assert.doesNotThrow(() => agentIdFromSignPub(12345 as unknown as string));
  assert.equal(agentIdFromSignPub(12345 as unknown as string), "agent_invalid");
  const hostile = { type: "profile_card", signature: "AAAA", sign_pub: 12345, owner: "agent_0000000000000000", expires_at: new Date(Date.now() + 1e6).toISOString() } as unknown as ProfileCard;
  assert.doesNotThrow(() => verifyCard(hostile));
  assert.equal(verifyCard(hostile).ok, false);
});

test("resilience regression: malformed server response (non-array) does not crash scan/poll", async () => {
  // Internal implementation note.
  // Internal implementation note.
  const SCRIPT =
    "const http=require('http');" +
    "const s=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});" +
    "if((req.url||'').startsWith('/directory'))res.end(JSON.stringify({cards:'not-an-array'}));" +
    "else res.end(JSON.stringify({envelopes:42}));});" +
    "s.listen(0,'127.0.0.1',()=>{console.log('PORT '+s.address().port)});";
  const proc = spawn(process.execPath, ["-e", SCRIPT], { stdio: ["ignore", "pipe", "ignore"] });
  const port: number = await new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("malformed server start timeout")), 5000);
    proc.stdout.on("data", (c: Buffer) => {
      buf += c.toString();
      const m = buf.match(/PORT (\d+)/);
      if (m) {
        clearTimeout(t);
        resolve(Number(m[1]));
      }
    });
    proc.once("error", reject);
  });
  const id = generateIdentity();
  const tp = new HttpTransport(`http://127.0.0.1:${port}`, () => id);
  try {
    assert.deepEqual(tp.scanCards(), [], "non-array cards should become [] without crashing");
    assert.deepEqual(tp.pollEnvelopes(id.agent_id), [], "non-array envelopes should become [] without crashing");
  } finally {
    proc.kill("SIGKILL");
  }
});
