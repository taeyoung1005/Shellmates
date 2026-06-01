import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildChannelServer } from "../src/channel/server.js";
import { bringToChat, engineFor, pair } from "./helpers.js";

const CHANNEL_METHOD = "notifications/claude/channel";
type Captured = { method: string; params: { content: string; meta: Record<string, unknown> } };

// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
test("channel race: tool-call ingest also pushes channel notifications with shared engine and sink", async () => {
  const p = pair();
  bringToChat(p, "hi");
  const bob = engineFor(p.bHome, p.net);
  const server = buildChannelServer(bob, {});
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "race-test", version: "0" });
  const captured: Captured[] = [];
  client.fallbackNotificationHandler = async (n: { method: string; params?: unknown }) => {
    if (n.method === CHANNEL_METHOD) captured.push(n as Captured);
  };
  await client.connect(ct);
  try {
    // Internal implementation note.
    assert.ok(p.a.send("race: tool ingested this").ok);

    // Internal implementation note.
    // Internal implementation note.
    await client.callTool({ name: "shellmates_status", arguments: {} });
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(captured.length, 1, "tool-path ingest should push one channel notification");
    assert.ok(captured[0]!.params.content.includes("race: tool ingested this"), "message body included");
    assert.equal(captured[0]!.params.meta.kind, "message");
  } finally {
    await client.close();
    await server.close();
  }
});

// Internal implementation note.
test("channel race: standalone engine has no sink, so tool ingest does not push", async () => {
  const p = pair();
  bringToChat(p, "hi");
  const server = buildChannelServer();
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
    assert.equal(captured.length, 0, "sink message body included ingestmessage body included pushmessage body included");
  } finally {
    await client.close();
    await server.close();
  }
});
