#!/usr/bin/env node
// 백그라운드 데몬 — relay를 주기 watch, 새 봉투 ingest, out-of-band 알림(사운드/notify.json/stderr).
// 컨텍스트 방화벽: 메시지 본문·코칭은 절대 출력하지 않는다. 카운트/이벤트/발신 alias 만 노출.
import { spawnSync } from "node:child_process";
import { isMainEntry } from "../core/entry.js";
import { Engine } from "../core/engine.js";
import type { IngestResult } from "../core/messaging.js";

const SOUND_ENABLED = process.env.TL_SOUND !== "0";

function playSound(): void {
  if (!SOUND_ENABLED) return;
  try {
    if (process.platform === "darwin") {
      spawnSync("afplay", ["/System/Library/Sounds/Glass.aiff"], { stdio: "ignore", timeout: 3000 });
    }
  } catch {
    /* best-effort: 사운드는 실패해도 무시 */
  }
}

function notifyLine(engine: Engine): void {
  const n = engine.state.notifications;
  // 본문 없음: 카운트 + 이벤트 + 발신 alias 까지만 (컨텍스트 방화벽)
  process.stderr.write(
    `🔔 Shellmates: ${n.unread} unread — last "${n.last_event ?? "-"}" from ${n.last_from_alias ?? "-"}\n`,
  );
}

/** 단일 폴링 틱. 새 이벤트가 있으면 out-of-band 알림. 거부 카운트 포함 전체 결과 반환. */
export function tick(engine: Engine): IngestResult {
  const before = engine.state.notifications.unread;
  const r = engine.poll();
  if (r.ingested > 0 || engine.state.notifications.unread > before) {
    playSound();
    notifyLine(engine);
  }
  return r;
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const intervalMs = Number(process.env.TL_DAEMON_INTERVAL_MS ?? "2000");
  const engine = Engine.open();
  if (!engine.agentId) {
    console.error("신원이 없습니다. 먼저 CLI에서 init 하세요.");
    process.exit(1);
  }
  if (once) {
    console.log(JSON.stringify(tick(engine)));
    return;
  }
  process.stderr.write(`Shellmates daemon watching for ${engine.agentId} (every ${intervalMs}ms). Ctrl-C to stop.\n`);
  setInterval(() => {
    try {
      tick(engine);
    } catch (e) {
      process.stderr.write(`daemon error: ${(e as Error).message}\n`);
    }
  }, intervalMs);
}

const isMain = isMainEntry(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
