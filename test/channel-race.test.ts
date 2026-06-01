import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildChannelServer } from "../src/channel/server.js";
import { bringToChat, engineFor, pair } from "./helpers.js";

const CHANNEL_METHOD = "notifications/claude/channel";
type Captured = { method: string; params: { content: string; meta: Record<string, unknown> } };

// 회귀: 채널 서버에서 "폴 루프가 아니라 도구 호출"이 수신 메시지를 먼저 ingest해도
// 채널 push가 보장되어야 한다. (이전 버그: 도구는 collector 없는 별도 engine으로 폴링 →
//  메시지를 조용히 삼켜 <channel> 미표시. fix: 단일 공유 engine + 모든 ingest가 sink로 push.)
test("channel race: 도구 호출(폴 루프 아님) ingest도 채널 push (공유 engine + sink)", async () => {
  const p = pair();
  bringToChat(p, "hi");
  const bob = engineFor(p.bHome, p.net); // 채널 서버가 쓸 단일 공유 engine
  const server = buildChannelServer(bob, {}); // engine 지정 → onItems sink 배선
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "race-test", version: "0" });
  const captured: Captured[] = [];
  client.fallbackNotificationHandler = async (n: { method: string; params?: unknown }) => {
    if (n.method === CHANNEL_METHOD) captured.push(n as Captured);
  };
  await client.connect(ct);
  try {
    // Alice가 메시지 전송 → relay/net에 Bob 앞 봉투 적재
    assert.ok(p.a.send("race: tool ingested this").ok);

    // 폴 루프(channelTick) 없이 shellmates_status 호출 — notificationState()가 폴링하며 메시지 ingest.
    // 도구 결과는 카운트만 반환(본문 미노출)이므로, 채널 push만이 본문을 세션에 띄울 수 있다.
    await client.callTool({ name: "shellmates_status", arguments: {} });
    await new Promise((r) => setTimeout(r, 40)); // microtask flush + notification 전달

    assert.equal(captured.length, 1, "도구-경로 ingest가 채널 알림 1건을 push해야 함");
    assert.ok(captured[0]!.params.content.includes("race: tool ingested this"), "본문 포함");
    assert.equal(captured[0]!.params.meta.kind, "message");
  } finally {
    await client.close();
    await server.close();
  }
});

// standalone(엔진 미지정)에서는 sink가 없어 도구 ingest가 push되지 않아야 한다(기존 동작 보존).
test("channel race: standalone(엔진 미지정)은 sink 없음 — 도구 ingest가 push 안 됨", async () => {
  const p = pair();
  bringToChat(p, "hi");
  const server = buildChannelServer(); // engine 미지정 → sink 없음
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "race-test2", version: "0" });
  const captured: Captured[] = [];
  client.fallbackNotificationHandler = async (n: { method: string; params?: unknown }) => {
    if (n.method === CHANNEL_METHOD) captured.push(n as Captured);
  };
  await client.connect(ct);
  try {
    assert.ok(p.a.send("no sink: not pushed").ok);
    await client.callTool({ name: "shellmates_status", arguments: {} });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(captured.length, 0, "sink 없으면 도구 ingest는 채널 push하지 않음");
  } finally {
    await client.close();
    await server.close();
  }
});
