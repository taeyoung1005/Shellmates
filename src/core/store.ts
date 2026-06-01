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

// state.json은 개인키(identity)를 담으므로 소유자 전용(0600)으로 기록(PLAN §10).
// tmp(항상 새로 생성 → mode 적용 보장) + rename(원자적, dest inode 교체)이라
// 기존에 느슨한 권한(예: 0644) 파일을 덮어써도 결과가 항상 mode가 된다.
function atomicWrite(path: string, data: string, mode = 0o600): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, { encoding: "utf8", mode });
  try {
    renameSync(tmp, path);
  } catch (e) {
    // rename 실패 시 stale tmp 정리 후 재던짐(누수 방지).
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* noop */
    }
    throw e;
  }
}

/**
 * 시크릿(개인키 백업 등)을 0600으로 안전하게 기록(덮어쓰기 포함).
 * writeFileSync의 mode는 "생성 시"에만 적용되므로 기존 파일을 덮어쓰면 무시된다 →
 * 항상 tmp+rename으로 dest inode를 교체해 권한을 보장한다.
 */
export function writeSecretFile(path: string, data: string): void {
  atomicWrite(path, data, 0o600);
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
