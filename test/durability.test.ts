// 적대적 리뷰에서 확정된 이슈에 대한 회귀 방지 테스트.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { resolveCtx } from "../src/core/config.js";
import { generateIdentity } from "../src/core/crypto.js";
import { Engine } from "../src/core/engine.js";
import { HttpTransport } from "../src/core/transport-http.js";
import { LocalFsTransport } from "../src/core/transport-local.js";
import type { Transport, PolledEnvelope, DirectoryQuery } from "../src/core/transport.js";
import type { Envelope, ProfileCard, PublicProfileCard } from "../src/core/types.js";
import { ALICE, BOB, tempRoot } from "./helpers.js";

// LocalFs를 감싸되 원하는 시점에 sendEnvelope/scanCards만 throw하게 만드는 카오스 transport.
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
}

test("HIGH regression: inbound message ingested in send() survives a throwing send (no silent loss)", () => {
  const root = tempRoot();
  const net = join(root, "net");
  const aliceCtx = resolveCtx({ TL_HOME: join(root, "alice"), TL_NET: net } as NodeJS.ProcessEnv);
  const bobCtx = resolveCtx({ TL_HOME: join(root, "bob"), TL_NET: net } as NodeJS.ProcessEnv);

  const chaos = new ChaosTransport(new LocalFsTransport(aliceCtx));
  const alice = new Engine(aliceCtx, chaos); // 카오스 주입
  const bob = new Engine(bobCtx); // 정상 LocalFs

  // 매칭 성사
  alice.init();
  const bId = bob.init().agent_id!;
  alice.makeProfile(ALICE);
  alice.publish();
  bob.makeProfile(BOB);
  bob.publish();
  assert.ok(alice.intro(bId, "hi bob").ok);
  const intro = bob.inbox().intros[0]!;
  assert.ok(bob.accept(intro.intro_id).ok);
  assert.ok(alice.open().chat, "alice 활성 대화 열림");

  // Bob이 메시지를 보냄(아직 Alice가 ingest 전 — relay에 대기)
  const MARK = "BOB_MSG_MUST_SURVIVE_42";
  assert.ok(bob.send(MARK).ok);

  // 이제 Alice의 send가 POST 단계에서 실패하도록 설정 → send()는 먼저 pollAndIngest(Bob 메시지 소비+삭제)
  chaos.failSend = true;
  const r = alice.send("alice reply that won't go out");
  assert.equal(r.ok, false, "send는 실패로 보고되어야 함");

  // 핵심: 실패했어도 Bob의 수신 메시지는 durable하게 저장되어 있어야 함(영구 유실 X)
  alice.reload();
  const texts = (alice.state.active_chat?.messages ?? []).map((m) => m.text);
  assert.ok(texts.includes(MARK), `수신 메시지가 살아남아야 함. 실제: ${JSON.stringify(texts)}`);

  // 재poll해도 중복 재수신/에러 없음(seen_env도 커밋됨)
  const again = alice.poll();
  assert.equal(again.ingested, 0, "이미 ingest된 메시지는 재수신되지 않아야 함(seen_env durable)");
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
  // Bob이 Alice에게 intro 전달(Alice inbox relay에 봉투 도착)
  assert.ok(bob.intro(aId, "hi from bob — must not be lost").ok);

  // scanCards가 throw하도록 설정 → scan()의 ingest(=intro 수신+relay 삭제)가 같은 tx면 롤백되어 유실됨.
  chaos.failScan = true;
  const r = alice.scan();
  assert.equal(r.ok, false, "scan은 실패로 보고");
  assert.deepEqual(r.matches, [], "matches는 빈 배열");

  // 핵심: scanCards가 throw해도 이미 ack(삭제)된 수신 intro는 durable하게 남아 있어야 함.
  alice.reload();
  assert.equal(alice.state.inbox_intros.length, 1, "throwing scanCards가 수신 intro를 유실시키면 안 됨");
});

test("availability: a peer's self-signed card with null array fields is rejected and does not break matching", async () => {
  const { signProfile, buildProfile, verifyCard } = await import("../src/core/profile.js");
  const { rankMatches } = await import("../src/core/matching.js");
  const mineId = generateIdentity();
  const evilId = generateIdentity();
  const mine = signProfile(mineId, buildProfile(mineId, ALICE));
  // 공격자가 자기 키로 정상 서명하지만 interests를 null로 만든 카드(서명은 유효, 필드는 악성)
  const evilBase = buildProfile(evilId, BOB) as unknown as Record<string, unknown>;
  evilBase.interests = null;
  const evil = signProfile(evilId, evilBase as never);
  // verifyCard가 거부해야 함(bad_fields)
  assert.equal(verifyCard(evil).ok, false, "null array 필드 카드는 거부");
  // 그리고 rankMatches가 그런 카드가 섞여도 throw하지 않아야 함(가용성)
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
  // 적대적 서버는 반드시 별도 프로세스여야 함: syncFetch(execFileSync)가 테스트 이벤트루프를 블로킹하므로
  // 같은 프로세스의 서버는 응답할 수 없어 데드락된다(spawn.ts와 동일 이유).
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
    assert.deepEqual(tp.scanCards(), [], "비배열 cards → [] (크래시 X)");
    assert.deepEqual(tp.pollEnvelopes(id.agent_id), [], "비배열 envelopes → [] (크래시 X)");
  } finally {
    proc.kill("SIGKILL");
  }
});
