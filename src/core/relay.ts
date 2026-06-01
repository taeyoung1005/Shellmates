// Internal implementation note.
// Internal implementation note.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "./config.js";
import { ensureDir } from "./store.js";
import type { Envelope } from "./types.js";
import { isAgentId, isPrefixedId } from "./util.js";

function inboxDir(ctx: Ctx, agentId: string): string {
  if (!isAgentId(agentId)) throw new Error(`invalid agent_id (path safety): ${agentId}`);
  return join(ctx.relayDir, agentId);
}

/** Internal implementation note. */
export function sendEnvelope(ctx: Ctx, env: Envelope): void {
  if (!isAgentId(env.to)) throw new Error(`invalid recipient agent_id: ${env.to}`);
  if (!isPrefixedId(env.id, "env")) throw new Error(`invalid envelope id: ${env.id}`);
  const dir = inboxDir(ctx, env.to);
  ensureDir(dir);
  writeFileSync(join(dir, `${env.id}.json`), JSON.stringify(env), "utf8");
}

export interface PolledEnvelope {
  env: Envelope;
  path: string;
}

/** Internal implementation note. */
export function pollEnvelopes(ctx: Ctx, myAgentId: string): PolledEnvelope[] {
  const dir = inboxDir(ctx, myAgentId);
  if (!existsSync(dir)) return [];
  const out: PolledEnvelope[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const path = join(dir, f);
    try {
      const env = JSON.parse(readFileSync(path, "utf8")) as Envelope;
      out.push({ env, path });
    } catch {
      // Internal implementation note.
      try {
        rmSync(path);
      } catch {
        /* noop */
      }
    }
  }
  // Internal implementation note.
  out.sort((a, b) => a.env.created_at.localeCompare(b.env.created_at));
  return out;
}

export function deleteEnvelope(path: string): void {
  try {
    if (existsSync(path)) rmSync(path);
  } catch {
    /* noop */
  }
}
