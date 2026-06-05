#!/usr/bin/env node
// Background daemon: polls the relay on an interval, ingesting new messages
// and emitting a desktop bell + stderr notification line on fresh activity.
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
    /* Sound is best-effort; ignore failures (no afplay, sandbox, etc.). */
  }
}

function notifyLine(engine: Engine): void {
  const n = engine.state.notifications;
  // Print a one-line unread summary to stderr (keeps stdout clean for --once JSON).
  process.stderr.write(
    `🔔 Shellmates: ${n.unread} unread — last "${n.last_event ?? "-"}" from ${n.last_from_alias ?? "-"}\n`,
  );
}

/** Run one poll cycle; sound + notify only when new messages or unread count rose. */
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
