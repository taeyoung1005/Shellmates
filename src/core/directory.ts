// Local directory of published profile cards: one signed JSON card per agent_id.
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

/** Write the signed card to the directory, keyed by its owner agent_id. */
export function publishCard(ctx: Ctx, card: ProfileCard): void {
  ensureDir(ctx.directoryDir);
  writeFileSync(cardPath(ctx, card.owner), JSON.stringify(card, null, 2), "utf8");
}

/** Remove an agent's published card from the directory, if present. */
export function revokeCard(ctx: Ctx, agentId: string): void {
  const p = cardPath(ctx, agentId);
  if (existsSync(p)) rmSync(p);
}

/** Return every card in the directory whose signature and expiry verify at `now`. */
export function scanCards(ctx: Ctx, now: Date = new Date()): PublicProfileCard[] {
  if (!existsSync(ctx.directoryDir)) return [];
  const out: PublicProfileCard[] = [];
  for (const f of readdirSync(ctx.directoryDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const card = JSON.parse(readFileSync(join(ctx.directoryDir, f), "utf8")) as ProfileCard;
      if (verifyCard(card, now).ok) out.push(card);
    } catch {
      // Skip unreadable or malformed card files.
    }
  }
  return out;
}

/** Load a single agent's card, returning it only if its signature and expiry verify at `now`. */
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
