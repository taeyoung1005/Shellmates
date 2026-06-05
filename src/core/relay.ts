// File-based relay: signed envelopes are written to per-recipient inbox
// directories under ctx.relayDir and polled/deleted by the addressee.
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

/** Drop an envelope into the recipient's inbox, keyed by its envelope id. */
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

/** Read all envelopes from my inbox, sorted oldest-first; missing inbox yields []. */
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
      // Unparseable/corrupt envelope file: discard it and move on.
      try {
        rmSync(path);
      } catch {
        /* noop */
      }
    }
  }
  // Oldest-first by creation time, with envelope id as a deterministic tie-break so
  // same-millisecond events apply in a stable order across processes.
  out.sort((a, b) => a.env.created_at.localeCompare(b.env.created_at) || a.env.id.localeCompare(b.env.id));
  return out;
}

export function deleteEnvelope(path: string): void {
  try {
    if (existsSync(path)) rmSync(path);
  } catch {
    /* noop */
  }
}
