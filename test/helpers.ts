// 테스트 공용 헬퍼 — 임시 TL_HOME/TL_NET 기반 엔진 생성.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine.js";
import type { ProfileAnswers } from "../src/core/types.js";

export function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tl-test-"));
}

export function engineFor(home: string, net: string): Engine {
  return Engine.open({ TL_HOME: home, TL_NET: net } as NodeJS.ProcessEnv);
}

export interface Pair {
  root: string;
  net: string;
  aHome: string;
  bHome: string;
  a: Engine;
  b: Engine;
}

export function pair(): Pair {
  const root = tempRoot();
  const net = join(root, "net");
  const aHome = join(root, "a");
  const bHome = join(root, "b");
  return { root, net, aHome, bHome, a: engineFor(aHome, net), b: engineFor(bHome, net) };
}

export const ALICE: ProfileAnswers = {
  display_name: "Alice",
  country: "Korea",
  languages: ["Korean", "English"],
  stacks: ["TypeScript", "Rust", "AI Agents"],
  interests: ["Startups", "AI Products", "Side Projects"],
  communication_style: "direct, logical",
  matching_modes: ["dating", "builder"],
  activity_hours: "night",
};

export const BOB: ProfileAnswers = {
  display_name: "Bob",
  country: "Spain",
  languages: ["English", "Spanish"],
  stacks: ["TypeScript", "React", "AI Tools"],
  interests: ["AI Products", "Design", "Side Projects"],
  communication_style: "warm, curious",
  matching_modes: ["dating", "builder"],
  activity_hours: "night",
};

/** a,b를 init→profile→publish→intro→accept 까지 진행해 활성 1:1 대화 상태로 만든다. */
export function bringToChat(p: Pair, firstMessage = "hi"): { aId: string; bId: string } {
  const aId = p.a.init().agent_id!;
  const bId = p.b.init().agent_id!;
  p.a.makeProfile(ALICE);
  p.a.publish();
  p.b.makeProfile(BOB);
  p.b.publish();
  const r = p.a.intro(bId, firstMessage);
  if (!r.ok) throw new Error("intro failed: " + r.message);
  const intro = p.b.inbox().intros[0]!;
  const acc = p.b.accept(intro.intro_id);
  if (!acc.ok) throw new Error("accept failed: " + acc.message);
  p.a.open(); // a가 수락 통지 수신
  return { aId, bId };
}
