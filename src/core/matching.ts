// Internal implementation note.
import type { MatchResult, ProfileCard, PublicProfileCard } from "./types.js";
import { intersect, jaccard } from "./util.js";

const W = {
  interests: 0.3,
  stacks: 0.25,
  languages: 0.15,
  modes: 0.1,
  style: 0.1,
  hours: 0.1,
} as const;

/** Internal implementation note. */
export function scoreMatch(mine: ProfileCard, theirs: PublicProfileCard): MatchResult {
  const interestsSim = jaccard(mine.interests, theirs.interests);
  const stacksSim = jaccard(mine.stacks, theirs.stacks);
  const langShared = intersect(mine.languages, theirs.languages);
  const langSim = langShared.length > 0 ? 1 : 0;
  const modeShared = intersect(mine.matching_modes, theirs.matching_modes);
  const modeSim = modeShared.length > 0 ? 1 : 0;
  const styleSim = mine.communication_style.trim().toLowerCase() === theirs.communication_style.trim().toLowerCase() ? 1 : 0;
  const hoursSim = mine.activity_hours && theirs.activity_hours && mine.activity_hours === theirs.activity_hours ? 1 : 0;

  let raw =
    W.interests * interestsSim +
    W.stacks * stacksSim +
    W.languages * langSim +
    W.modes * modeSim +
    W.style * styleSim +
    W.hours * hoursSim;

  // Internal implementation note.
  raw *= 0.7 + 0.3 * clamp01(theirs.profile_confidence);

  const score = Math.round(clamp01(raw) * 100);

  const reasons: string[] = [];
  const sharedInterests = intersect(mine.interests, theirs.interests);
  const sharedStacks = intersect(mine.stacks, theirs.stacks);
  if (sharedInterests.length) reasons.push(`Shared interests: ${sharedInterests.slice(0, 4).join(", ")}`);
  if (sharedStacks.length) reasons.push(`Shared stacks: ${sharedStacks.slice(0, 4).join(", ")}`);
  if (langShared.length) reasons.push(`Shared languages: ${langShared.join(", ")}`);
  if (styleSim) reasons.push(`Similar communication style (${mine.communication_style})`);
  if (hoursSim) reasons.push(`Similar activity hours (${mine.activity_hours})`);
  if (modeShared.length) reasons.push(`Matching goals overlap: ${modeShared.join(", ")}`);
  if (reasons.length === 0) reasons.push("Few obvious overlaps, but worth exploring");

  return { card: theirs, score, reasons };
}

/**
 * Internal implementation note.
 */
export function rankMatches(
  mine: ProfileCard,
  candidates: PublicProfileCard[],
  opts: { blocked?: string[]; noResuggest?: string[]; myAgentId?: string } = {},
): MatchResult[] {
  const blocked = new Set(opts.blocked ?? []);
  const noRe = new Set(opts.noResuggest ?? []);
  const results: MatchResult[] = [];
  for (const c of candidates) {
    if (c.owner === (opts.myAgentId ?? mine.owner)) continue;
    if (blocked.has(c.owner) || noRe.has(c.owner)) continue;
    if (intersect(mine.matching_modes, c.matching_modes).length === 0) continue;
    results.push(scoreMatch(mine, c));
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
