import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { dispatch, parse } from "../src/cli/cli.js";
import { engineFor, tempRoot } from "./helpers.js";

test("cli one-shot: init → profile → publish → status", () => {
  const root = tempRoot();
  const net = join(root, "net");
  const e = engineFor(join(root, "a"), net);

  const init = dispatch(e, parse(["init"])).result as { agent_id?: string };
  assert.match(init.agent_id ?? "", /^agent_/);

  const prof = dispatch(
    e,
    parse(["profile", "--name", "Alice", "--country", "Korea", "--interests", "AI,Startups", "--stacks", "TypeScript", "--modes", "dating,builder"]),
  ).result as { ok: boolean };
  assert.equal(prof.ok, true);

  const pub = dispatch(e, parse(["publish"])).result as { ok: boolean };
  assert.equal(pub.ok, true);

  const st = dispatch(e, parse(["status"])).result as { published: boolean; agent_id: string | null };
  assert.equal(st.published, true);
  assert.ok(st.agent_id);
});

test("cli parse handles flags, positionals, quoted text, --json", () => {
  const p = parse(["intro", "agent_abc", "hello there", "--json"]);
  assert.equal(p.command, "intro");
  assert.equal(p.positionals[0], "agent_abc");
  assert.equal(p.positionals[1], "hello there");
  assert.equal(p.json, true);
});

test("cli accepts /shellmates and shellmates prefixes", () => {
  assert.equal(parse(["/shellmates", "scan"]).command, "scan");
  assert.equal(parse(["shellmates", "intro", "agent_x", "hi"]).command, "intro");
  assert.equal(parse(["shellmates", "intro", "agent_x", "hi"]).positionals[0], "agent_x");
  assert.equal(parse(["scan"]).command, "scan");
  assert.equal(parse(["/shellmates"]).command, "help");
});

test("cli intro without target returns usage", () => {
  const root = tempRoot();
  const e = engineFor(join(root, "a"), join(root, "net"));
  assert.match(dispatch(e, parse(["intro"])).human, /Usage/);
});

test("cli help lists commands", () => {
  const root = tempRoot();
  const e = engineFor(join(root, "a"), join(root, "net"));
  assert.match(dispatch(e, parse(["help"])).human, /init/);
});

test("cli poll command returns ingest counts (body-free)", () => {
  const root = tempRoot();
  const e = engineFor(join(root, "a"), join(root, "net"));
  e.init();
  const out = dispatch(e, parse(["poll"]));
  const r = out.result as { ingested: number; rejected: number; events: string[] };
  assert.equal(typeof r.ingested, "number");
  assert.equal(typeof r.rejected, "number");
  assert.match(out.human, /polled — ingested=\d+ rejected=\d+/);
});

test("cli unknown command is flagged (nonzero) instead of silently showing help", () => {
  const root = tempRoot();
  const e = engineFor(join(root, "a"), join(root, "net"));
  const out = dispatch(e, parse(["bogusxyz"]));
  assert.equal(out.unknown, true);
  assert.match(out.human, /Unknown command/);
  // help must not be marked unknown.
  assert.notEqual(dispatch(e, parse(["help"])).unknown, true);
});
