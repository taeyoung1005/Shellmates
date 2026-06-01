// 로컬 상태 영속화 (TL_HOME/state.json) + out-of-band 알림 상태 파일(notify.json).
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

function atomicWrite(path: string, data: string): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
}

export function loadState(ctx: Ctx): State {
  if (!existsSync(ctx.statePath)) return emptyState();
  try {
    const raw = readFileSync(ctx.statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<State>;
    // 누락 필드 보강(스키마 진화 대비)
    return { ...emptyState(), ...parsed } as State;
  } catch {
    return emptyState();
  }
}

export function saveState(ctx: Ctx, state: State): void {
  atomicWrite(ctx.statePath, JSON.stringify(state, null, 2));
  // statusLine/데몬이 싸게 읽을 수 있도록 알림 상태를 별도 파일로도 기록
  writeNotify(ctx, state.notifications);
}

export function writeNotify(ctx: Ctx, n: NotificationState): void {
  atomicWrite(ctx.notifyPath, JSON.stringify(n));
}

function sleepSync(ms: number): void {
  // 동기 대기(짧은 임계구역용). SharedArrayBuffer + Atomics.wait.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 상태 파일에 대한 프로세스 간 배타 락.
 * 데몬과 CLI가 동시에 reload→mutate→save 할 때 발생하는 lost-update 레이스를 방지한다.
 * 락 파일을 O_EXCL로 생성하고, 임계구역(fn) 실행 후 해제. 오래된(stale) 락은 자동 회수.
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
      // stale lock(10초 이상) 회수
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 10000) {
          rmSync(lockPath);
          continue;
        }
      } catch {
        /* 락이 사라졌으면 재시도 */
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
