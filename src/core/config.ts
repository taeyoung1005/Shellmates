// 경로/컨텍스트 설정. 단일 머신 데모는 TL_HOME(개별 신원) + TL_NET(공유 네트워크)로 구성.
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Ctx {
  home: string; // 이 신원의 로컬 데이터 디렉토리
  net: string; // 공유 네트워크 루트 (디렉토리 + relay)
  directoryDir: string; // net/directory — 공개 프로필 카드
  relayDir: string; // net/relay — 암호화 봉투 전달
  statePath: string; // home/state.json
  notifyPath: string; // home/notify.json — out-of-band 알림 상태(statusLine/데몬용)
}

export function resolveCtx(env: NodeJS.ProcessEnv = process.env): Ctx {
  const home = resolve(env.TL_HOME || join(homedir(), ".terminallove"));
  const net = resolve(env.TL_NET || join(homedir(), ".terminallove-net"));
  return {
    home,
    net,
    directoryDir: join(net, "directory"),
    relayDir: join(net, "relay"),
    statePath: join(home, "state.json"),
    notifyPath: join(home, "notify.json"),
  };
}
