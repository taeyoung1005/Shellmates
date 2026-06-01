#!/usr/bin/env node
// TerminalLove CLI — "별도 세션" 표면. /dating 명령어를 원샷/REPL/--json 으로 실행.
// 컨텍스트 방화벽: 이 표면(대화·코칭)은 코딩 세션과 분리된 별도 프로세스에서 돈다.
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { Engine } from "../core/engine.js";
import type { CoachingPayload, IntroRecord, MatchResult, ProfileAnswers, MatchingMode } from "../core/types.js";

interface Parsed {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
  json: boolean;
}

export function parse(argv: string[]): Parsed {
  let json = false;
  const rest: string[] = [];
  for (const a of argv) {
    if (a === "--json") json = true;
    else rest.push(a);
  }
  const command = rest.shift() ?? "help";
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!;
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(tok);
    }
  }
  return { command, positionals, flags, json };
}

function csv(v: string | boolean | undefined): string[] | undefined {
  if (typeof v !== "string") return undefined;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderMatches(matches: MatchResult[]): string {
  if (matches.length === 0) return "  (후보 없음)";
  return matches
    .map((m, i) => {
      const c = m.card;
      const name = c.display_name ?? c.owner;
      return [
        `  [${i + 1}] ${c.owner}  ${name}`,
        `      ${c.country} · ${c.languages.join("/")} · ${c.stacks.slice(0, 4).join(", ")}  — ${m.score}%`,
        `      why: ${m.reasons.slice(0, 3).join(" / ")}`,
      ].join("\n");
    })
    .join("\n");
}

function renderIntros(intros: IntroRecord[]): string {
  if (intros.length === 0) return "  (받은 intro 없음)";
  return intros
    .map((it, i) => {
      const name = it.profile.display_name ?? it.peer.agent_id;
      const msg = it.first_message ? `\n      "${it.first_message}"` : "";
      return `  [${i + 1}] ${it.intro_id}  from ${it.peer.agent_id} (${name})${msg}`;
    })
    .join("\n");
}

function renderCoaching(c: CoachingPayload): string {
  const lines: string[] = [];
  if (c.warnings.length) lines.push("  ⚠ " + c.warnings.join("\n  ⚠ "));
  lines.push("  Coach:");
  for (const g of c.guidance) lines.push("    - " + g);
  lines.push("  Suggested reply:");
  lines.push("    " + c.suggested_reply);
  return lines.join("\n");
}

function profileAnswersFromFlags(flags: Record<string, string | boolean>): ProfileAnswers {
  const a: ProfileAnswers = {
    country: typeof flags.country === "string" ? flags.country : "Korea",
    languages: csv(flags.langs) ?? ["Korean", "English"],
    stacks: csv(flags.stacks) ?? [],
    interests: csv(flags.interests) ?? [],
  };
  if (typeof flags.name === "string") a.display_name = flags.name;
  if (typeof flags.style === "string") a.communication_style = flags.style;
  const modes = csv(flags.modes);
  if (modes) a.matching_modes = modes as MatchingMode[];
  if (typeof flags.hours === "string") a.activity_hours = flags.hours;
  if (flags.longform) a.long_form = true;
  return a;
}

const HELP = `TerminalLove — /dating 명령어
  init                          신원(키페어) 생성
  whoami                        내 agent_id / 프로필 요약
  profile [--name --country --langs a,b --stacks a,b --interests a,b --style ".." --modes a,b --hours night --longform]
  publish | unpublish           프로필 디렉토리 게시/철회
  export-profile [--out path]   서명된 프로필 파일로 내보내기
  import-profile <file>         서명된 프로필 가져오기(검증 후 디렉토리 추가)
  invite                        초대 링크 생성
  scan                          매칭 후보 검색(로컬 계산)
  intro <agent_id> ["메시지"]    소개 요청 (활성 대화 없을 때만)
  cancel                        보낸 intro 취소
  inbox                         받은 intro 목록
  accept <intro_id> | decline <intro_id>
  open                          현재 1:1 대화 + 코치
  send "메시지"                  현재 대화에 전송
  reply                         답장 코칭(전송은 send로)
  coach "초안"                   작성 초안 코칭
  alias <별명>                   현재 상대 별명
  end [--block]                 대화 종료(언매치) [+차단]
  block [agent_id]              일방향 차단(기본=현재 상대)
  report <agent_id> [사유]       신고
  backup-key [--out path] | import-key <file> | rotate-key   키 관리
  status | notify               상태 / 알림
  help | exit
  (전역: --json 기계판독 출력. 본문/코칭은 기본 레다크션, --include-bodies 로 포함)`;

// 명령 실행. 반환: { result, human }
export function dispatch(engine: Engine, p: Parsed): { result: unknown; human: string } {
  const { command, positionals, flags } = p;
  const arg0 = positionals[0];
  switch (command) {
    case "init": {
      const r = engine.init();
      return { result: r, human: r.message };
    }
    case "whoami": {
      const prof = engine.getProfile();
      const id = engine.agentId;
      const human = id
        ? `agent_id: ${id}\nprofile: ${prof ? (prof.display_name ?? "(이름없음)") + " · " + prof.country + " · " + prof.stacks.join(", ") : "(없음)"}\npublished: ${engine.state.published}`
        : "신원이 없습니다. init 하세요.";
      return { result: { agent_id: id, profile: prof, published: engine.state.published }, human };
    }
    case "profile": {
      const r = engine.makeProfile(profileAnswersFromFlags(flags));
      const human = r.ok && r.card
        ? `${r.message}\n  ${r.card.display_name ?? r.card.owner} · ${r.card.country} · ${r.card.stacks.join(", ")} · 신뢰도 ${Math.round(r.card.profile_confidence * 100)}%`
        : r.message;
      return { result: r, human };
    }
    case "publish":
      return wrap(engine.publish());
    case "unpublish":
      return wrap(engine.unpublish());
    case "export-profile":
      return wrap(engine.exportProfile(typeof flags.out === "string" ? flags.out : undefined));
    case "import-profile": {
      if (!arg0) return { result: { ok: false }, human: "사용법: import-profile <file>" };
      return wrap(engine.importProfile(arg0));
    }
    case "invite":
      return wrap(engine.invite());
    case "backup-key":
      return wrap(engine.backupKey(typeof flags.out === "string" ? flags.out : undefined));
    case "import-key": {
      if (!arg0) return { result: { ok: false }, human: "사용법: import-key <file>" };
      return wrap(engine.importKey(arg0));
    }
    case "rotate-key":
      return wrap(engine.rotateKey());
    case "scan": {
      const r = engine.scan();
      return { result: r, human: `${r.message}\n${renderMatches(r.matches)}` };
    }
    case "intro": {
      if (!arg0) return { result: { ok: false }, human: "사용법: intro <agent_id> [\"메시지\"]" };
      const r = engine.intro(arg0, positionals[1]);
      return wrap(r);
    }
    case "cancel":
      return wrap(engine.cancel());
    case "inbox": {
      const r = engine.inbox();
      return { result: r, human: `${r.message}\n${renderIntros(r.intros)}` };
    }
    case "accept": {
      if (!arg0) return { result: { ok: false }, human: "사용법: accept <intro_id>" };
      return wrap(engine.accept(arg0));
    }
    case "decline": {
      if (!arg0) return { result: { ok: false }, human: "사용법: decline <intro_id>" };
      return wrap(engine.decline(arg0));
    }
    case "open": {
      const r = engine.open();
      if (!r.chat) return { result: r, human: r.message };
      const lines: string[] = [`대화 상대: ${r.chat.alias ?? r.chat.partner_profile.display_name ?? r.chat.partner.agent_id} (${r.chat.partner.agent_id})`];
      if (r.cold) lines.push("  (cold: 오래 응답이 없습니다. [end/block/계속])");
      for (const m of r.chat.messages.slice(-12)) {
        const who = m.direction === "in" ? (r.chat.alias ?? "상대") : "나";
        lines.push(`  ${who}: ${m.text}${m.flagged ? "  ⚠[" + (m.flags ?? []).join(",") + "]" : ""}`);
      }
      if (r.coaching) lines.push(renderCoaching(r.coaching));
      return { result: r, human: lines.join("\n") };
    }
    case "send": {
      if (!arg0) return { result: { ok: false }, human: "사용법: send \"메시지\"" };
      return wrap(engine.send(positionals.join(" ")));
    }
    case "reply": {
      const r = engine.reply();
      return { result: r, human: r.coaching ? renderCoaching(r.coaching) : r.message };
    }
    case "coach": {
      if (!arg0) return { result: { ok: false }, human: "사용법: coach \"초안\"" };
      const r = engine.coach(positionals.join(" "));
      return { result: r, human: r.coaching ? renderCoaching(r.coaching) : r.message };
    }
    case "alias": {
      if (!arg0) return { result: { ok: false }, human: "사용법: alias <별명>" };
      return wrap(engine.alias(arg0));
    }
    case "end":
      return wrap(engine.end(flags.block === true));
    case "block":
      return wrap(engine.block(arg0));
    case "report": {
      if (!arg0) return { result: { ok: false }, human: "사용법: report <agent_id> [사유]" };
      return wrap(engine.report(arg0, positionals.slice(1).join(" ")));
    }
    case "status": {
      const s = engine.status();
      return { result: s, human: JSON.stringify(s, null, 2) };
    }
    case "notify": {
      const n = engine.notificationState();
      const human = n.unread > 0 ? `🔔 ${n.unread}건 — ${n.last_from_alias ?? ""} (${n.last_event})` : "새 알림 없음";
      return { result: n, human };
    }
    case "help":
    default:
      return { result: { ok: true }, human: HELP };
  }
}

function wrap(r: { ok: boolean; message: string }): { result: unknown; human: string } {
  return { result: r, human: (r.ok ? "" : "✗ ") + r.message };
}

/**
 * --json 출력 시 컨텍스트 방화벽: 메시지 본문/코칭/첫 메시지를 기본 레다크션.
 * --include-bodies 플래그가 있을 때만 원문 포함(별도 세션 TUI 등 명시적 용도).
 */
export function redactForJson(result: unknown, includeBodies: boolean): unknown {
  if (includeBodies) return result;
  const r = JSON.parse(JSON.stringify(result ?? null));
  if (r && typeof r === "object") {
    if (r.chat && Array.isArray(r.chat.messages)) {
      r.chat.message_count = r.chat.messages.length;
      delete r.chat.messages;
      r.bodies_redacted = true;
    }
    if (r.coaching) {
      delete r.coaching;
      r.coaching_redacted = true;
    }
    if (Array.isArray(r.intros)) {
      for (const it of r.intros) {
        if (it && it.first_message !== undefined) {
          delete it.first_message;
          it.first_message_redacted = true;
        }
      }
    }
  }
  return r;
}

async function repl(engine: Engine): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "/dating > " });
  console.log("TerminalLove REPL — 'help'로 명령 목록, 'exit'로 종료.");
  rl.prompt();
  for await (const line of rl) {
    const cmd = line.trim();
    if (cmd === "exit" || cmd === "quit") break;
    if (cmd) {
      // 간단 토크나이저: 따옴표 구간 보존
      const tokens = cmd.match(/"[^"]*"|\S+/g)?.map((t) => t.replace(/^"|"$/g, "")) ?? [];
      const out = dispatch(engine, parse(tokens));
      console.log(out.human);
    }
    rl.prompt();
  }
  rl.close();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const engine = Engine.open();
  if (argv.length === 0) {
    await repl(engine);
    return;
  }
  const p = parse(argv);
  const out = dispatch(engine, p);
  if (p.json) {
    console.log(JSON.stringify(redactForJson(out.result, p.flags["include-bodies"] === true)));
  } else {
    console.log(out.human);
  }
}

// 직접 실행 시에만 main (테스트에서 import 가능하도록)
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
