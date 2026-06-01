// 로컬 매칭 — 내 카드와 상대 카드의 호환도(0..100) + 사유를 계산. 중앙 서버 없이 전부 로컬.
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

/** 단일 후보 점수 계산 */
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

  // 상대 프로필 신뢰도를 약하게 반영
  raw *= 0.7 + 0.3 * clamp01(theirs.profile_confidence);

  const score = Math.round(clamp01(raw) * 100);

  const reasons: string[] = [];
  const sharedInterests = intersect(mine.interests, theirs.interests);
  const sharedStacks = intersect(mine.stacks, theirs.stacks);
  if (sharedInterests.length) reasons.push(`공통 관심사: ${sharedInterests.slice(0, 4).join(", ")}`);
  if (sharedStacks.length) reasons.push(`공통 스택: ${sharedStacks.slice(0, 4).join(", ")}`);
  if (langShared.length) reasons.push(`공통 언어: ${langShared.join(", ")}`);
  if (styleSim) reasons.push(`대화 스타일이 비슷함 (${mine.communication_style})`);
  if (hoursSim) reasons.push(`활동 시간대가 비슷함 (${mine.activity_hours})`);
  if (modeShared.length) reasons.push(`매칭 목적 일치: ${modeShared.join(", ")}`);
  if (reasons.length === 0) reasons.push("뚜렷한 공통점은 적지만 탐색해볼 만함");

  return { card: theirs, score, reasons };
}

/**
 * 후보 목록 매칭: self/blocked/no_resuggest/매칭목적 불일치 제외 후 점수순 정렬.
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
    if (c.owner === (opts.myAgentId ?? mine.owner)) continue; // 자기 자신 제외
    if (blocked.has(c.owner) || noRe.has(c.owner)) continue;
    if (intersect(mine.matching_modes, c.matching_modes).length === 0) continue; // 매칭 목적 겹쳐야 노출
    results.push(scoreMatch(mine, c));
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
