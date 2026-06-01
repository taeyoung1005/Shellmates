// 채널 서버가 실제 배포 경로(HTTP relay 서버)에서도 동작하는지 — 별도 프로세스 relay + HTTP transport.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildChannelServer, channelTick } from "../src/channel/server.js";
import { bringToChatNet, netEngine, startNet, type NetCtx } from "./net-harness.js";

const CHANNEL_METHOD = "notifications/claude/channel";

let net: NetCtx;
before(async () => {
  net = await startNet();
});
after(async () => {
  await net.srv.close();
});

test("channel over HTTP relay: incoming message → claude/channel push", async () => {
  const alice = netEngine(net, "ch-a");
  const bob = netEngine(net, "ch-b");
  const { aId } = bringToChatNet(alice, bob, "hi over the wire");
  assert.ok(alice.send("network hello bob").ok);

  const server = buildChannelServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "ch-net-test", version: "0" });
  const captured: { method: string; params: { content: string; meta: Record<string, unknown> } }[] = [];
  client.fallbackNotificationHandler = async (n: { method: string; params?: unknown }) => {
    if (n.method === CHANNEL_METHOD) captured.push(n as never);
  };
  await client.connect(ct);
  try {
    const sent = await channelTick(server, bob);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(sent, 1, "one push over HTTP path");
    assert.equal(captured.length, 1);
    assert.ok(captured[0]!.params.content.includes("network hello bob"));
    assert.equal(captured[0]!.params.meta.kind, "message");
    assert.equal(captured[0]!.params.meta.from, aId);
    // durable: 재폴링 시 중복 없음
    assert.equal(await channelTick(server, bob), 0);
  } finally {
    await client.close();
    await server.close();
  }
});
