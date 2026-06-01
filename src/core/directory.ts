// 공개 프로필 디렉토리 — 공유 폴더(net/directory)에 서명된 카드를 게시/구독.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "./config.js";
import { verifyCard } from "./profile.js";
import { ensureDir } from "./store.js";
import type { ProfileCard, PublicProfileCard } from "./types.js";
import { isAgentId } from "./util.js";

function cardPath(ctx: Ctx, agentId: string): string {
  if (!isAgentId(agentId)) throw new Error(`invalid agent_id (path safety): ${agentId}`);
  return join(ctx.directoryDir, `${agentId}.json`);
}

/** 서명된 카드를 디렉토리에 게시 */
export function publishCard(ctx: Ctx, card: ProfileCard): void {
  ensureDir(ctx.directoryDir);
  writeFileSync(cardPath(ctx, card.owner), JSON.stringify(card, null, 2), "utf8");
}

/** 게시 철회(파일 삭제) */
export function revokeCard(ctx: Ctx, agentId: string): void {
  const p = cardPath(ctx, agentId);
  if (existsSync(p)) rmSync(p);
}

/** 디렉토리 전체 스캔 → 서명/만료 검증을 통과한 카드만 반환 */
export function scanCards(ctx: Ctx, now: Date = new Date()): PublicProfileCard[] {
  if (!existsSync(ctx.directoryDir)) return [];
  const out: PublicProfileCard[] = [];
  for (const f of readdirSync(ctx.directoryDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const card = JSON.parse(readFileSync(join(ctx.directoryDir, f), "utf8")) as ProfileCard;
      if (verifyCard(card, now).ok) out.push(card);
    } catch {
      // 손상/형식 오류 카드는 무시
    }
  }
  return out;
}

/** 특정 agent_id의 검증된 카드 조회 */
export function lookupCard(ctx: Ctx, agentId: string, now: Date = new Date()): PublicProfileCard | null {
  if (!isAgentId(agentId)) return null;
  const p = cardPath(ctx, agentId);
  if (!existsSync(p)) return null;
  try {
    const card = JSON.parse(readFileSync(p, "utf8")) as ProfileCard;
    return verifyCard(card, now).ok ? card : null;
  } catch {
    return null;
  }
}
