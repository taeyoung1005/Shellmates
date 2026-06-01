import test from "node:test";
import assert from "node:assert/strict";
import { generateIdentity } from "../src/core/crypto.js";
import { rankMatches, scoreMatch } from "../src/core/matching.js";
import { buildProfile } from "../src/core/profile.js";
import { ALICE, BOB } from "./helpers.js";

test("scoreMatch gives positive score + reasons for overlapping profiles", () => {
  const a = generateIdentity();
  const b = generateIdentity();
  const ca = buildProfile(a, ALICE);
  const cb = buildProfile(b, BOB);
  const r = scoreMatch(ca, cb);
  assert.ok(r.score > 0 && r.score <= 100);
  assert.ok(r.reasons.length > 0);
});

test("rankMatches excludes self, blocked, no_resuggest", () => {
  const a = generateIdentity();
  const b = generateIdentity();
  const ca = buildProfile(a, ALICE);
  const cb = buildProfile(b, BOB);
  const all = [ca, cb];
  const base = rankMatches(ca, all, { myAgentId: a.agent_id });
  assert.equal(base.length, 1);
  assert.equal(base[0]!.card.owner, b.agent_id);

  assert.equal(rankMatches(ca, all, { myAgentId: a.agent_id, blocked: [b.agent_id] }).length, 0);
  assert.equal(rankMatches(ca, all, { myAgentId: a.agent_id, noResuggest: [b.agent_id] }).length, 0);
});

test("rankMatches requires overlapping matching_modes", () => {
  const a = generateIdentity();
  const b = generateIdentity();
  const ca = buildProfile(a, { ...ALICE, matching_modes: ["dating"] });
  const cb = buildProfile(b, { ...BOB, matching_modes: ["friend"] });
  assert.equal(rankMatches(ca, [cb], { myAgentId: a.agent_id }).length, 0);
});
