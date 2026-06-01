// Transport 양 구현(LocalFs/Http) 동등성 — 같은 directory/relay 동작을 관찰 수준에서 일치 확인.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCtx } from "../src/core/config.js";
import { generateIdentity, signEnvelope } from "../src/core/crypto.js";
import { buildProfile, signProfile } from "../src/core/profile.js";
import { HttpTransport } from "../src/core/transport-http.js";
import { LocalFsTransport } from "../src/core/transport-local.js";
import type { Transport } from "../src/core/transport.js";
import { PROTOCOL_VERSION, type Envelope, type Identity } from "../src/core/types.js";
import { newId, newNonce, nowIso } from "../src/core/util.js";
import { ALICE_NET } from "./net-harness.js";
import { spawnRelayServer, type SpawnedServer } from "../src/server/spawn.js";

let srv: SpawnedServer;
const TOKEN = "equiv-token";

before(async () => {
  srv = await spawnRelayServer({
    env: { TL_SERVER_DATA: join(mkdtempSync(join(tmpdir(), "tl-equiv-")), "d"), TL_RELAY_ACCESS_TOKEN: TOKEN, TL_RATE_MAX: "100000", TL_RATE_RELAY_POST_MAX: "100000" },
  });
});
after(async () => {
  await srv.close();
});

function localTransport(): Transport {
  const root = mkdtempSync(join(tmpdir(), "tl-local-"));
  const ctx = resolveCtx({ TL_HOME: join(root, "h"), TL_NET: join(root, "net") } as NodeJS.ProcessEnv);
  return new LocalFsTransport(ctx);
}

function httpTransport(getId: () => Identity | null): Transport {
  return new HttpTransport(srv.baseUrl, getId, TOKEN);
}

function mkEnvelope(from: Identity, toId: string): Envelope {
  return signEnvelope(
    {
      type: "intro",
      v: PROTOCOL_VERSION,
      id: newId("env"),
      from: from.agent_id,
      to: toId,
      conversation_id: newId("chat"),
      created_at: nowIso(),
      nonce: newNonce(),
    },
    from,
  );
}

// 두 transport에 대해 동일 시나리오를 실행하는 헬퍼.
// revoke(DELETE /directory)는 소유자 서명 인증이 필요하므로, transport는 카드 owner 신원에 바인딩한다.
function directoryScenario(makeTp: (owner: Identity) => Transport): { lookupOwner: string | null; inScan: boolean; afterRevoke: boolean } {
  const id = generateIdentity();
  const tp = makeTp(id);
  const card = signProfile(id, buildProfile(id, ALICE_NET));
  tp.publishCard(card);
  const looked = tp.lookupCard(id.agent_id);
  const inScan = tp.scanCards().some((c) => c.owner === id.agent_id);
  tp.revokeCard(id.agent_id);
  const afterRevoke = tp.lookupCard(id.agent_id) !== null;
  return { lookupOwner: looked?.owner ?? null, inScan, afterRevoke };
}

function relayScenario(tp: Transport, recip: Identity): { polledIds: string[]; afterDelete: number } {
  const sender = generateIdentity();
  const env = mkEnvelope(sender, recip.agent_id);
  tp.sendEnvelope(env);
  const polled = tp.pollEnvelopes(recip.agent_id);
  const polledIds = polled.map((p) => p.env.id);
  for (const p of polled) tp.deleteEnvelope(p.ref);
  const afterDelete = tp.pollEnvelopes(recip.agent_id).length;
  return { polledIds, afterDelete };
}

test("directory equivalence: LocalFs vs Http (publish/lookup/scan/revoke)", () => {
  const local = directoryScenario(() => localTransport());
  const http = directoryScenario((owner) => httpTransport(() => owner));

  assert.ok(local.lookupOwner !== null, "local lookup이 카드 반환");
  assert.ok(http.lookupOwner !== null, "http lookup이 카드 반환");
  assert.equal(local.inScan, true);
  assert.equal(http.inScan, true);
  assert.equal(local.afterRevoke, false, "local revoke 후 lookup null");
  assert.equal(http.afterRevoke, false, "http revoke 후 lookup null");
});

test("relay equivalence: LocalFs vs Http (send/poll/delete)", () => {
  const localRecip = generateIdentity();
  const local = relayScenario(localTransport(), localRecip);
  const httpRecip = generateIdentity();
  const http = relayScenario(httpTransport(() => httpRecip), httpRecip);

  assert.equal(local.polledIds.length, 1, "local: 봉투 1건 poll");
  assert.equal(http.polledIds.length, 1, "http: 봉투 1건 poll");
  assert.equal(local.afterDelete, 0, "local: delete 후 0건");
  assert.equal(http.afterDelete, 0, "http: delete 후 0건");
});

test("directory pagination: scanCards pages through ALL cards beyond one page (PLAN §10)", () => {
  // 페이지 크기보다 많은 카드를 게시하고, 작은 limit로 scanCards가 전부 순회하는지 확인.
  const N = 7;
  const owners: string[] = [];
  for (let i = 0; i < N; i++) {
    const id = generateIdentity();
    owners.push(id.agent_id);
    new HttpTransport(srv.baseUrl, () => id, TOKEN).publishCard(signProfile(id, buildProfile(id, { ...ALICE_NET, display_name: `P${i}` })));
  }
  const tp = new HttpTransport(srv.baseUrl, () => generateIdentity(), TOKEN);
  // 페이지 크기 3 → 7개를 보려면 3페이지 순회 필요
  const got = tp.scanCards(new Date(), { limit: 3 });
  const gotOwners = new Set(got.map((c) => c.owner));
  for (const o of owners) assert.ok(gotOwners.has(o), `페이지네이션으로 모든 카드(${o})를 봐야 함 — 본 수: ${got.length}`);
  assert.ok(got.length >= N, `최소 ${N}개(페이지네이션) 반환, 실제 ${got.length}`);
});

test("server rejects tampered card on PUT (400), and client never sees it", async () => {
  const { syncFetch } = await import("../src/core/sync-fetch.js");
  const id = generateIdentity();
  const card = signProfile(id, buildProfile(id, ALICE_NET));
  // 서명 후 필드 변조 → 서명 불일치
  const tampered = { ...card, interests: ["Hacking", "Spam"] };
  const put = syncFetch(`${srv.baseUrl}/directory/${id.agent_id}`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-tl-access": TOKEN },
    body: JSON.stringify(tampered),
  });
  assert.equal(put.status, 400, "변조 카드 PUT은 서버가 거부(400)");
  // 클라 lookup도 (존재하지 않으므로) null
  const tp = httpTransport(() => id);
  assert.equal(tp.lookupCard(id.agent_id), null, "거부된 카드는 lookup되지 않음");
});
