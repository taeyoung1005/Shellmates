// Internal implementation note.
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

// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
function atomicWrite(path: string, data: string, mode = 0o600): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, { encoding: "utf8", mode });
  try {
    renameSync(tmp, path);
  } catch (e) {
    // Internal implementation note.
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* noop */
    }
    throw e;
  }
}

/**
 * Internal implementation note.
 * Internal implementation note.
 * Internal implementation note.
 */
export function writeSecretFile(path: string, data: string): void {
  atomicWrite(path, data, 0o600);
}

export function loadState(ctx: Ctx): State {
  if (!existsSync(ctx.statePath)) return emptyState();
  try {
    const raw = readFileSync(ctx.statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<State>;
    // Internal implementation note.
    return { ...emptyState(), ...parsed } as State;
  } catch {
    return emptyState();
  }
}

export function saveState(ctx: Ctx, state: State): void {
  atomicWrite(ctx.statePath, JSON.stringify(state, null, 2));
  // Internal implementation note.
  writeNotify(ctx, state.notifications);
}

export function writeNotify(ctx: Ctx, n: NotificationState): void {
  atomicWrite(ctx.notifyPath, JSON.stringify(n));
}

function sleepSync(ms: number): void {
  // Internal implementation note.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Internal implementation note.
 * Internal implementation note.
 * Internal implementation note.
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
      // Internal implementation note.
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 10000) {
          rmSync(lockPath);
          continue;
        }
      } catch {
        /* Internal implementation note. */
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
