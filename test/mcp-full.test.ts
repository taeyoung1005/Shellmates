import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildFullServer } from "../src/mcp/full.js";
import { BOB, engineFor, tempRoot } from "./helpers.js";

function parse(res: unknown): any {
  const r = res as { content: { text: string }[] };
  return JSON.parse(r.content.map((c) => c.text).join("\n"));
}

test("FULL MCP exposes Shellmates tools and drives a real match/chat (dedicated session)", async () => {
  const root = tempRoot();
  const net = join(root, "net");
  const prev = { h: process.env.TL_HOME, n: process.env.TL_NET, s: process.env.TL_SOUND };
  process.env.TL_HOME = join(root, "me");
  process.env.TL_NET = net;
  process.env.TL_SOUND = "0";
  try {
    // Publish the peer.
    const partner = engineFor(join(root, "bob"), net);
    const bobId = partner.init().agent_id!;
    partner.makeProfile(BOB);
    partner.publish();

    const server = buildFullServer();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(ct);

    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const need of ["shellmates_status", "shellmates_scan", "shellmates_intro", "shellmates_inbox", "shellmates_accept", "shellmates_open", "shellmates_send", "shellmates_coach"]) {
      assert.ok(names.includes(need), "missing tool: " + need);
    }
    const toolDefs = (await client.listTools()).tools;
    const coachTool = toolDefs.find((t) => t.name === "shellmates_coach");
    assert.ok(coachTool, "shellmates_coach definition exists");
    assert.match(coachTool.description ?? "", /strategy|direction/i);
    assert.doesNotMatch(coachTool.description ?? "", /write.*for the user|send.*without.*exact text/i);

    // Create and publish my profile via MCP tools.
    assert.equal(
      parse(
        await client.callTool({
          name: "shellmates_set_profile",
          arguments: { country: "Korea", interests: ["AI Products", "Startups"], stacks: ["TypeScript"], languages: ["English"], matching_modes: ["dating", "builder"] },
        }),
      ).ok,
      true,
    );
    assert.equal(parse(await client.callTool({ name: "shellmates_publish", arguments: {} })).ok, true);

    // Scan and find the peer.
    const scan = parse(await client.callTool({ name: "shellmates_scan", arguments: {} }));
    assert.ok(scan.matches.some((m: { agent_id: string }) => m.agent_id === bobId), "scan should find partner");

    // Intro, peer accept, then open chat.
    assert.equal(parse(await client.callTool({ name: "shellmates_intro", arguments: { agent_id: bobId, message: "hi bob" } })).ok, true);
    const intro = partner.inbox().intros[0]!;
    assert.ok(partner.accept(intro.intro_id).ok);

    const open = parse(await client.callTool({ name: "shellmates_open", arguments: {} }));
    assert.equal(open.ok, true);
    assert.equal(open.partner.agent_id, bobId);

    // shellmates_open returns peer message bodies in the dedicated session by design.
    partner.send("Nice to meet you, Alice!");
    const open2 = parse(await client.callTool({ name: "shellmates_open", arguments: {} }));
    assert.ok(open2.messages.some((m: { direction: string; text: string }) => m.direction === "in" && m.text.includes("Nice to meet you")));
    assert.equal(open2.coaching.suggested_reply, undefined);
    assert.match(open2.coaching.reply_strategy, /question|peer|interest|direction/i);

    await client.close();
  } finally {
    if (prev.h === undefined) delete process.env.TL_HOME;
    else process.env.TL_HOME = prev.h;
    if (prev.n === undefined) delete process.env.TL_NET;
    else process.env.TL_NET = prev.n;
    if (prev.s === undefined) delete process.env.TL_SOUND;
    else process.env.TL_SOUND = prev.s;
  }
});
