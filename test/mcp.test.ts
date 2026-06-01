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
  engineFor(home, net).init(); // 상태 존재하게

  try {
    const server = buildServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientT);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    // 정확히 두 개의 컨텍스트-세이프 도구만 존재해야 함 (본문/대화/코칭 도구 없음)
    assert.deepEqual(names, ["terminallove_open_session", "terminallove_status"]);

    const res = (await client.callTool({ name: "terminallove_status", arguments: {} })) as {
      content: { type: string; text: string }[];
    };
    const text = res.content.map((c) => c.text).join("\n");
    assert.match(text, /unread=/);
    // 본문/코칭 같은 표현이 들어가면 안 됨
    assert.ok(!/suggested|메시지 본문|coach/i.test(text));

    await client.close();
  } finally {
    if (prevHome === undefined) delete process.env.TL_HOME;
    else process.env.TL_HOME = prevHome;
    if (prevNet === undefined) delete process.env.TL_NET;
    else process.env.TL_NET = prevNet;
  }
});
