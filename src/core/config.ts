// 경로/컨텍스트 설정.
//  - 로컬 폴더 모드(기본): TL_HOME(개별 신원) + TL_NET(공유 네트워크).
//  - 네트워크 모드: TL_SERVER(또는 TL_RELAY_URL/TL_DIRECTORY_URL) 설정 시 HTTP relay/directory 서버 사용.
//    TL_SERVER 미설정이면 기존 로컬 폴더 모드로 동작(하위 호환).
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** 네트워크 서버 접속 설정. baseUrl 없으면 로컬 폴더 모드. */
export interface ServerConfig {
  baseUrl: string; // 예: "http://127.0.0.1:8787" (끝 슬래시 제거)
  accessToken?: string; // admission gate 공유 토큰(X-TL-Access). 없으면 미전송.
}

export interface Ctx {
  home: string; // 이 신원의 로컬 데이터 디렉토리
  net: string; // 공유 네트워크 루트 (디렉토리 + relay) — 로컬 폴더 모드 전용
  directoryDir: string; // net/directory — 공개 프로필 카드(로컬 모드)
  relayDir: string; // net/relay — 암호화 봉투 전달(로컬 모드)
  statePath: string; // home/state.json
  notifyPath: string; // home/notify.json — out-of-band 알림 상태(statusLine/데몬용)
  server: ServerConfig | null; // 설정 시 HTTP transport 사용, null이면 LocalFs
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** 환경에서 서버 설정 해석. TL_SERVER > TL_RELAY_URL > TL_DIRECTORY_URL 순. */
export function resolveServer(env: NodeJS.ProcessEnv): ServerConfig | null {
  const raw = env.TL_SERVER || env.TL_RELAY_URL || env.TL_DIRECTORY_URL;
  if (!raw || !raw.trim()) return null;
  const baseUrl = stripTrailingSlash(raw.trim());
  const token = env.TL_RELAY_ACCESS_TOKEN?.trim();
  return token ? { baseUrl, accessToken: token } : { baseUrl };
}

export function resolveCtx(env: NodeJS.ProcessEnv = process.env): Ctx {
  const home = resolve(env.TL_HOME || env.SHELLMATES_HOME || join(homedir(), ".shellmates"));
  const net = resolve(env.TL_NET || env.SHELLMATES_NET || join(homedir(), ".shellmates-net"));
  return {
    home,
    net,
    directoryDir: join(net, "directory"),
    relayDir: join(net, "relay"),
    statePath: join(home, "state.json"),
    notifyPath: join(home, "notify.json"),
    server: resolveServer(env),
  };
}
