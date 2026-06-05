// Local on-disk state store: atomic writes, advisory file locking, and notification sidecar.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { Ctx } from "./config.js";
import type { NotificationState, State } from "./types.js";

export function emptyState(): State {
  return {
    identity: null,
    profile: null,
    published: false,
    active_chat: null,
    past_chats: [],
    inbox_intros: [],
    outbox_intro: null,
    blocked: [],
    no_resuggest: [],
    reports: [],
    seen_env: [],
    seen_conversations: [],
    notifications: {
      unread: 0,
      last_from_alias: null,
      last_from_agent: null,
      last_event: null,
      updated_at: null,
    },
    settings: { cold_days: 7, default_modes: ["dating", "builder", "friend"] },
  };
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

// Write to a unique temp file then rename into place so readers never see a
// partially written file. The temp name includes pid + timestamp to avoid
// collisions, and the file is created with the given mode (default 0o600).
function atomicWrite(path: string, data: string, mode = 0o600): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, { encoding: "utf8", mode });
  try {
    renameSync(tmp, path);
  } catch (e) {
    // Rename failed; clean up the leftover temp file before rethrowing.
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* noop */
    }
    throw e;
  }
}

/**
 * Atomically write a file containing secret material (e.g. identity keys)
 * with owner-only 0o600 permissions.
 */
export function writeSecretFile(path: string, data: string): void {
  atomicWrite(path, data, 0o600);
}

export function loadState(ctx: Ctx): State {
  if (!existsSync(ctx.statePath)) return emptyState();
  try {
    const raw = readFileSync(ctx.statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<State>;
    const base = emptyState();
    const merged = { ...base, ...parsed } as State;
    // Deep-merge the nested objects so an older/partial state.json keeps its defaults
    // (e.g. settings.cold_days, notification fields) instead of being wiped by a top-level spread.
    merged.settings = { ...base.settings, ...(parsed.settings ?? {}) };
    merged.notifications = { ...base.notifications, ...(parsed.notifications ?? {}) };
    return merged;
  } catch {
    return emptyState();
  }
}

export function saveState(ctx: Ctx, state: State): void {
  atomicWrite(ctx.statePath, JSON.stringify(state, null, 2));
  // Keep the notification sidecar file in sync with the saved state.
  writeNotify(ctx, state.notifications);
}

export function writeNotify(ctx: Ctx, n: NotificationState): void {
  atomicWrite(ctx.notifyPath, JSON.stringify(n));
}

function sleepSync(ms: number): void {
  // Block the current thread for ms by waiting on an Atomics value that never changes.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run fn while holding an advisory lock (an exclusively-created `.lock` file)
 * on the state file. Spins until the lock is acquired or a 5s deadline passes,
 * and always releases the lock afterward.
 */
export function withLock<T>(ctx: Ctx, fn: () => T): T {
  const lockPath = ctx.statePath + ".lock";
  ensureDir(dirname(ctx.statePath));
  const deadline = Date.now() + 5000;
  let fd: number | undefined;
  for (;;) {
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // Lock already exists: treat it as stale and steal it if older than 10s,
      // otherwise keep waiting.
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 10000) {
          rmSync(lockPath);
          continue;
        }
      } catch {
        /* lock vanished between stat and rm; fall through and retry */
      }
      if (Date.now() > deadline) throw new Error("state lock timeout");
      sleepSync(20);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* noop */
      }
    }
    try {
      rmSync(lockPath);
    } catch {
      /* noop */
    }
  }
}

export function readNotify(ctx: Ctx): NotificationState {
  if (!existsSync(ctx.notifyPath)) {
    return { unread: 0, last_from_alias: null, last_from_agent: null, last_event: null, updated_at: null };
  }
  try {
    return JSON.parse(readFileSync(ctx.notifyPath, "utf8")) as NotificationState;
  } catch {
    return { unread: 0, last_from_alias: null, last_from_agent: null, last_event: null, updated_at: null };
  }
}
