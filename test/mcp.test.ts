import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/server.js";
import { engineFor, tempRoot } from "./helpers.js";

test("MCP exposes ONLY context-safe tools (firewall) and status returns counts only", async () => {
  const root = tempRoot();
  const home = join(root, "a");
  const net = join(root, "net");
  const prevHome = process.env.TL_HOME;
  const prevNet = process.env.TL_NET;
  process.env.TL_HOME = home;
  process.env.TL_NET = net;
  engineFor(home, net).init();

  try {
    const server = buildServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientT);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    // Internal implementation note.
    assert.deepEqual(names, ["shellmates_open_session", "shellmates_status"]);

    const res = (await client.callTool({ name: "shellmates_status", arguments: {} })) as {
      content: { type: string; text: string }[];
    };
    const text = res.content.map((c) => c.text).join("\n");
    assert.match(text, /unread=/);
    // Internal implementation note.
    assert.ok(!/suggested|message body|coach/i.test(text));

    await client.close();
  } finally {
    if (prevHome === undefined) delete process.env.TL_HOME;
    else process.env.TL_HOME = prevHome;
    if (prevNet === undefined) delete process.env.TL_NET;
    else process.env.TL_NET = prevNet;
  }
});
