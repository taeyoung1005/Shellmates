#!/usr/bin/env node
// Internal implementation note.
// Internal implementation note.
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
    /* Internal implementation note. */
  }
}

function notifyLine(engine: Engine): void {
  const n = engine.state.notifications;
  // Internal implementation note.
  process.stderr.write(
    `🔔 Shellmates: ${n.unread} unread — last "${n.last_event ?? "-"}" from ${n.last_from_alias ?? "-"}\n`,
  );
}

/** Internal implementation note. */
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
    console.error("Identity is missing. Run init in the CLI first.");
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
