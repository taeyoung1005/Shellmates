// Relay — 암호화 봉투 전달. 공유 폴더(net/relay/<수신 agent_id>/<env_id>.json).
// relay는 from/to/timestamp/size만 볼 수 있고 본문(body)은 암호문이라 못 본다.
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

/** 봉투를 수신자 inbox에 투입. to/id 형식을 검증해 경로 traversal을 차단. */
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

/** 내 inbox의 봉투들을 읽어온다(삭제는 호출자가 처리 후 deleteEnvelope). */
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
      // 손상 봉투는 제거
      try {
        rmSync(path);
      } catch {
        /* noop */
      }
    }
  }
  // 도착 순서 비슷하게: created_at 기준 정렬
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
