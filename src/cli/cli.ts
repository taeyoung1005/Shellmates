#!/usr/bin/env node
// Shellmates CLI for the isolated conversation surface.
import { createInterface } from "node:readline";
import { isMainEntry } from "../core/entry.js";
import { Engine } from "../core/engine.js";
import type { CoachingPayload, IntroRecord, MatchResult, ProfileAnswers, MatchingMode } from "../core/types.js";
import { openShellmates, PACKAGE_HELP, resetShellmates, setupShellmates, startShellmates } from "../package/commands.js";

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
  // Accept `/shellmates scan`, `shellmates scan`, and bare `scan`.
  let command = rest.shift() ?? "help";
  if (command === "/shellmates" || command === "shellmates") command = rest.shift() ?? "help";
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
  if (matches.length === 0) return "  (no candidates)";
  return matches
    .map((m, i) => {
      const c = m.card;
      const name = c.display_name ?? c.owner;
      const presence = c.presence?.status ?? "offline";
      return [
        `  [${i + 1}] ${c.owner}  ${name}`,
        `      ${c.country} · ${c.languages.join("/")} · ${c.stacks.slice(0, 4).join(", ")} · ${presence}  — ${m.score}%`,
        `      why: ${m.reasons.slice(0, 3).join(" / ")}`,
      ].join("\n");
    })
    .join("\n");
}

function renderIntros(intros: IntroRecord[]): string {
  if (intros.length === 0) return "  (no received intros)";
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
  lines.push("  Reply approach:");
  lines.push("    " + c.reply_strategy);
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
  if (typeof flags["home-relay"] === "string") a.home_relay = flags["home-relay"];
  return a;
}

const HELP = `Shellmates — /shellmates commands
  init                          Create identity keys
  whoami                        Show agent_id and profile summary
  profile [--name --country --langs a,b --stacks a,b --interests a,b --style ".." --modes a,b --hours night --longform --home-relay url]
  profile --from-agent          Draft profile from local agent records; review before publish
  publish | unpublish           Publish or remove profile from the directory
  export-profile [--out path]   Export signed profile card
  import-profile <file>         Import a signed profile card
  invite                        Create invite link
  scan                          Search people who may be good matches
  intro <agent_id> ["message"]   Send intro when no active chat exists
  cancel                        Cancel pending outbound intro
  poll                          Ingest relay envelopes now (counts only)
  inbox                         List received intros
  accept <intro_id> | decline <intro_id>
  open                          Open current 1:1 chat and coaching
  send "message"                Send to current chat
  reply                         Reply coaching; send separately
  coach "draft"                 Coach a draft
  alias <name>                  Set current peer alias
  end [--block]                 End chat, optionally block
  block [agent_id]              One-way block; defaults to current peer
  report <agent_id> [reason]    Report peer
  backup-key [--out path] [--passphrase p] | import-key <file> [--passphrase p] | rotate-key
  status | notify               Status / notifications
  help | exit
  Global: --json emits machine-readable output. Bodies/coaching are redacted unless --include-bodies is set.`;

// Execute a parsed command. unknown=true makes one-shot mode exit nonzero.
export function dispatch(engine: Engine, p: Parsed): { result: unknown; human: string; unknown?: boolean } {
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
        ? `agent_id: ${id}\nprofile: ${prof ? (prof.display_name ?? "(unnamed)") + " · " + prof.country + " · " + prof.stacks.join(", ") : "(none)"}\npublished: ${engine.state.published}`
        : "No identity yet. Run init.";
      return { result: { agent_id: id, profile: prof, published: engine.state.published }, human };
    }
    case "profile": {
      let answers = profileAnswersFromFlags(flags);
      let observeNote = "";
      // --from-agent drafts from local records, then explicit flags override.
      if (flags["from-agent"] === true) {
        const obs = engine.observeForProfile();
        const merged: ProfileAnswers = {
          country: answers.country && answers.country !== "Korea" ? answers.country : obs.draft.country || answers.country,
          languages: csv(flags.langs) ?? (obs.draft.languages.length ? obs.draft.languages : answers.languages),
          stacks: csv(flags.stacks) ?? obs.draft.stacks,
          interests: csv(flags.interests) ?? obs.draft.interests,
          communication_style: typeof flags.style === "string" ? flags.style : obs.draft.communication_style,
          matching_modes: csv(flags.modes) ? (csv(flags.modes) as MatchingMode[]) : obs.draft.matching_modes,
        };
        if (typeof flags.name === "string") merged.display_name = flags.name;
        if (typeof flags.hours === "string") merged.activity_hours = flags.hours;
        else if (obs.draft.activity_hours) merged.activity_hours = obs.draft.activity_hours;
        // Carry through flags that the observed-draft merge doesn't reconstruct.
        if (answers.long_form !== undefined) merged.long_form = answers.long_form;
        if (answers.home_relay) merged.home_relay = answers.home_relay;
        answers = merged;
        observeNote = `\n  (observed: ${obs.source}, files=${obs.scannedFiles}, chars=${obs.chars} — ${obs.note})`;
      }
      const r = engine.makeProfile(answers);
      const human = r.ok && r.card
        ? `${r.message}${observeNote}\n  ${r.card.display_name ?? r.card.owner} · ${r.card.country || "(country unset)"} · ${r.card.stacks.join(", ") || "(stack unset)"} · interests ${r.card.interests.join(", ") || "-"} · confidence ${Math.round(r.card.profile_confidence * 100)}%\n  Review it, then run publish.`
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
      if (!arg0) return { result: { ok: false }, human: "Usage: import-profile <file>" };
      return wrap(engine.importProfile(arg0));
    }
    case "invite":
      return wrap(engine.invite());
    case "backup-key":
      return wrap(
        engine.backupKey(
          typeof flags.out === "string" ? flags.out : undefined,
          typeof flags.passphrase === "string" ? flags.passphrase : undefined,
        ),
      );
    case "import-key": {
      if (!arg0) return { result: { ok: false }, human: "Usage: import-key <file> [--passphrase pass]" };
      return wrap(engine.importKey(arg0, typeof flags.passphrase === "string" ? flags.passphrase : undefined));
    }
    case "rotate-key":
      return wrap(engine.rotateKey());
    case "scan": {
      const r = engine.scan();
      return { result: r, human: `${r.message}\n${renderMatches(r.matches)}` };
    }
    case "intro": {
      if (!arg0) return { result: { ok: false }, human: "Usage: intro <agent_id> [\"message\"]" };
      // Recombine the remaining tokens so an unquoted multi-word message is not truncated,
      // matching send/coach. slice(1) drops the agent_id; undefined keeps the no-message path.
      const message = positionals.length > 1 ? positionals.slice(1).join(" ") : undefined;
      const r = engine.intro(arg0, message);
      return wrap(r);
    }
    case "poll": {
      // Ingest inbound envelopes now; output remains count-only.
      const r = engine.poll();
      const human = `polled — ingested=${r.ingested} rejected=${r.rejected}` + (r.events.length ? ` events=${r.events.join(", ")}` : "");
      return { result: r, human };
    }
    case "cancel":
      return wrap(engine.cancel());
    case "inbox": {
      const r = engine.inbox();
      return { result: r, human: `${r.message}\n${renderIntros(r.intros)}` };
    }
    case "accept": {
      if (!arg0) return { result: { ok: false }, human: "Usage: accept <intro_id>" };
      return wrap(engine.accept(arg0));
    }
    case "decline": {
      if (!arg0) return { result: { ok: false }, human: "Usage: decline <intro_id>" };
      return wrap(engine.decline(arg0));
    }
    case "open": {
      const r = engine.open();
      if (!r.chat) return { result: r, human: r.message };
      const lines: string[] = [`Peer: ${r.chat.alias ?? r.chat.partner_profile.display_name ?? r.chat.partner.agent_id} (${r.chat.partner.agent_id})`];
      if (r.cold) lines.push("  (cold: no recent response. Consider end/block/continue.)");
      for (const m of r.chat.messages.slice(-12)) {
        const who = m.direction === "in" ? (r.chat.alias ?? "peer") : "me";
        lines.push(`  ${who}: ${m.text}${m.flagged ? "  ⚠[" + (m.flags ?? []).join(",") + "]" : ""}`);
      }
      if (r.coaching) lines.push(renderCoaching(r.coaching));
      return { result: r, human: lines.join("\n") };
    }
    case "send": {
      if (!arg0) return { result: { ok: false }, human: "Usage: send \"message\"" };
      return wrap(engine.send(positionals.join(" ")));
    }
    case "reply": {
      const r = engine.reply();
      return { result: r, human: r.coaching ? renderCoaching(r.coaching) : r.message };
    }
    case "coach": {
      if (!arg0) return { result: { ok: false }, human: "Usage: coach \"draft\"" };
      const r = engine.coach(positionals.join(" "));
      return { result: r, human: r.coaching ? renderCoaching(r.coaching) : r.message };
    }
    case "alias": {
      if (!arg0) return { result: { ok: false }, human: "Usage: alias <name>" };
      return wrap(engine.alias(arg0));
    }
    case "end":
      return wrap(engine.end(flags.block === true));
    case "block":
      return wrap(engine.block(arg0));
    case "report": {
      if (!arg0) return { result: { ok: false }, human: "Usage: report <agent_id> [reason]" };
      return wrap(engine.report(arg0, positionals.slice(1).join(" ")));
    }
    case "status": {
      const s = engine.status();
      return { result: s, human: JSON.stringify(s, null, 2) };
    }
    case "notify": {
      const n = engine.notificationState();
      const human = n.unread > 0 ? `🔔 ${n.unread} unread — ${n.last_from_alias ?? ""} (${n.last_event})` : "No new notifications";
      return { result: n, human };
    }
    case "help":
      return { result: { ok: true }, human: HELP };
    default:
      return { result: { ok: false, error: "unknown_command", command }, human: `Unknown command: ${command}\n\n${HELP}`, unknown: true };
  }
}

function wrap(r: { ok: boolean; message: string }): { result: unknown; human: string } {
  return { result: r, human: (r.ok ? "" : "✗ ") + r.message };
}

/**
 * JSON output redacts message bodies, coaching, and first messages by default.
 * --include-bodies includes them for explicit separate-session use.
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
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "/shellmates > " });
  console.log("Shellmates REPL — type 'help' for commands, 'exit' to quit.");
  rl.prompt();
  for await (const line of rl) {
    const cmd = line.trim();
    if (cmd === "exit" || cmd === "quit") break;
    if (cmd) {
      // Simple tokenizer that preserves quoted spans.
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
  const packageCommand = argv[0];
  if (packageCommand === "setup") {
    console.log(setupShellmates(argv.slice(1)));
    return;
  }
  if (packageCommand === "open") {
    console.log(openShellmates(argv.slice(1)));
    return;
  }
  if (packageCommand === "start") {
    console.log(startShellmates(argv.slice(1)));
    return;
  }
  if (packageCommand === "reset") {
    console.log(resetShellmates(argv.slice(1)));
    return;
  }
  if (packageCommand === "sm-channel" || packageCommand === "channel") {
    const { runChannelServer } = await import("../channel/server.js");
    await runChannelServer(argv.slice(1));
    return;
  }
  if (packageCommand === "sm-mcp" || packageCommand === "mcp") {
    const { runThinMcpServer } = await import("../mcp/server.js");
    await runThinMcpServer(argv.slice(1));
    return;
  }
  if (packageCommand === "sm-relay" || packageCommand === "relay") {
    const { runRelayServer } = await import("../server/server.js");
    await runRelayServer();
    return;
  }
  if (packageCommand === "package-help") {
    console.log(PACKAGE_HELP);
    return;
  }
  const chatArgv = packageCommand === "chat" ? argv.slice(1) : argv;
  const engine = Engine.open();
  if (chatArgv.length === 0) {
    await repl(engine);
    return;
  }
  const p = parse(chatArgv);
  const out = dispatch(engine, p);
  if (p.json) {
    console.log(JSON.stringify(redactForJson(out.result, p.flags["include-bodies"] === true)));
  } else {
    console.log(out.human);
  }
  // Unknown commands exit nonzero so script typos do not look successful.
  if (out.unknown) process.exitCode = 2;
}

// Run main only for direct execution.
const isMain = isMainEntry(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
