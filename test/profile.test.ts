import test from "node:test";
import assert from "node:assert/strict";
import { generateIdentity } from "../src/core/crypto.js";
import { buildProfile, signProfile, verifyCard } from "../src/core/profile.js";
import { addDaysIso } from "../src/core/util.js";
import { ALICE } from "./helpers.js";

test("build → sign → verify ok", () => {
  const id = generateIdentity();
  const card = signProfile(id, buildProfile(id, ALICE));
  const v = verifyCard(card);
  assert.ok(v.ok, v.reason);
  assert.equal(card.owner, id.agent_id);
  assert.equal(card.sign_pub, id.sign_pub);
  assert.ok(card.profile_confidence > 0 && card.profile_confidence <= 1);
});

test("tampered card fails signature", () => {
  const id = generateIdentity();
  const card = signProfile(id, buildProfile(id, ALICE));
  assert.equal(verifyCard({ ...card, interests: ["Hacking"] }).ok, false);
  assert.equal(verifyCard({ ...card, country: "Mars" }).ok, false);
});

test("expired card fails", () => {
  const id = generateIdentity();
  const card = signProfile(id, { ...buildProfile(id, ALICE), expires_at: addDaysIso(-1) });
  assert.equal(verifyCard(card).reason, "expired");
});

test("owner binding mismatch fails", () => {
  const id = generateIdentity();
  const other = generateIdentity();
  const card = signProfile(id, buildProfile(id, ALICE));
  assert.equal(verifyCard({ ...card, owner: other.agent_id }).ok, false);
});
