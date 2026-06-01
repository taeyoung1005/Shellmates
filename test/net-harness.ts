// 네트워크 테스트 공용 하네스 — relay 서버를 별도 프로세스로 띄우고 HTTP 모드 엔진을 만든다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine.js";
import { spawnRelayServer, type SpawnedServer } from "../src/server/spawn.js";

export interface NetCtx {
  srv: SpawnedServer;
  token: string;
  root: string;
  serverData: string;
}

export async function startNet(opts: { token?: string; env?: Record<string, string | undefined> } = {}): Promise<NetCtx> {
  const root = mkdtempSync(join(tmpdir(), "tl-net-"));
  const serverData = join(root, "serverData");
  const token = opts.token ?? "test-token";
  const env: Record<string, string | undefined> = {
    TL_SERVER_DATA: serverData,
    // 기본은 토큰 잠금. open 테스트는 opts.env로 덮어씀.
    TL_RELAY_ACCESS_TOKEN: token,
    // 테스트 간 rate 간섭 방지: 기본은 넉넉히(특정 테스트에서만 낮춤)
    TL_RATE_MAX: "100000",
    TL_RATE_RELAY_POST_MAX: "100000",
    ...opts.env,
  };
  const srv = await spawnRelayServer({ env });
  return { srv, token, root, serverData };
}

export function netEngine(net: NetCtx, name: string): Engine {
  return Engine.open({
    TL_HOME: join(net.root, name),
    TL_NET: join(net.root, `${name}-net`), // 의도적으로 서로 다르게 → 공유 폴더 없음 증명
    TL_SERVER: net.srv.baseUrl,
    TL_RELAY_ACCESS_TOKEN: net.token,
  } as NodeJS.ProcessEnv);
}

export const ALICE_NET = {
  display_name: "Alice",
  country: "Korea",
  languages: ["Korean", "English"],
  stacks: ["TypeScript", "Rust", "AI Agents"],
  interests: ["Startups", "AI Products", "Side Projects"],
  communication_style: "direct, logical",
  matching_modes: ["dating", "builder"] as ("dating" | "builder")[],
  activity_hours: "night",
};

export const BOB_NET = {
  display_name: "Bob",
  country: "Spain",
  languages: ["English", "Spanish"],
  stacks: ["TypeScript", "React", "AI Tools"],
  interests: ["AI Products", "Design", "Side Projects"],
  communication_style: "warm, curious",
  matching_modes: ["dating", "builder"] as ("dating" | "builder")[],
  activity_hours: "night",
};

/** 두 HTTP 엔진을 init→profile→publish→intro→accept 까지 진행해 활성 1:1 대화 상태로. */
export function bringToChatNet(a: Engine, b: Engine, firstMessage = "hi over the wire"): { aId: string; bId: string } {
  a.init();
  const bId = b.init().agent_id!;
  const aId = a.agentId!;
  a.makeProfile(ALICE_NET);
  a.publish();
  b.makeProfile(BOB_NET);
  b.publish();
  const r = a.intro(bId, firstMessage);
  if (!r.ok) throw new Error("intro failed: " + r.message);
  const intro = b.inbox().intros[0]!;
  const acc = b.accept(intro.intro_id);
  if (!acc.ok) throw new Error("accept failed: " + acc.message);
  a.open(); // accept 통지 수신
  return { aId, bId };
}
