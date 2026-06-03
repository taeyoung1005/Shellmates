import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_PUBLIC_RELAY = "https://shellmates.parktaeyoung.com/relay";
const CHANNEL_SERVER_NAME = "shellmates-channel";
const CLAUDE_CHANNEL_PROMPT = `server:${CHANNEL_SERVER_NAME}`;
const PACKAGE_NAME = "@taeyoung1005/shellmates";
const NPX_CMD = `npx -y ${PACKAGE_NAME}`;

interface ParsedPackageArgs {
  flags: Record<string, string | boolean>;
}

interface SetupSelection {
  mode: "network" | "server" | "private" | "local";
  label: "public network" | "private relay" | "local shared folder";
  serverUrl?: string;
  localFolder?: string;
  token?: string;
  shellmatesDir: string;
  shellmatesHome: string;
}

function envHome(env: NodeJS.ProcessEnv): string {
  return env.HOME || homedir();
}

function parsePackageArgs(argv: string[]): ParsedPackageArgs {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { flags };
}

function stringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  return typeof flags[key] === "string" ? flags[key] : undefined;
}

function selectionFromArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): SetupSelection {
  const { flags } = parsePackageArgs(argv);
  const shellmatesDir = stringFlag(flags, "dir") || env.SHELLMATES_DIR || join(envHome(env), "shellmates");
  const shellmatesHome = stringFlag(flags, "home") || join(shellmatesDir, "home");
  const token = stringFlag(flags, "token") || env.TL_RELAY_ACCESS_TOKEN;
  const publicRelay = env.SHELLMATES_PUBLIC_RELAY_URL || DEFAULT_PUBLIC_RELAY;

  if (typeof flags["local-folder"] === "string") {
    return {
      mode: "local",
      label: "local shared folder",
      localFolder: flags["local-folder"],
      token,
      shellmatesDir,
      shellmatesHome,
    };
  }

  if (typeof flags.private === "string") {
    return {
      mode: "private",
      label: "private relay",
      serverUrl: flags.private,
      token,
      shellmatesDir,
      shellmatesHome,
    };
  }

  const serverUrl = stringFlag(flags, "server") || env.TL_SERVER || publicRelay;
  return {
    mode: typeof flags.server === "string" ? "server" : "network",
    label: "public network",
    serverUrl,
    token,
    shellmatesDir,
    shellmatesHome,
  };
}

function channelArgs(selection: SetupSelection): string[] {
  const args = ["-y", PACKAGE_NAME, "sm-channel"];
  if (selection.mode === "local") {
    args.push("--local-folder", selection.localFolder!);
  } else {
    args.push("--server", selection.serverUrl!);
  }
  return args;
}

function onboardingGuide(selection: SetupSelection): string {
  const endpoint = selection.mode === "local" ? selection.localFolder! : selection.serverUrl!;
  return `# Welcome to Shellmates

This Claude Code session is only for Shellmates conversations. Human peer messages can appear here, and this session can use Shellmates tools to match, open chats, and send messages.

## Start Here

1. Run \`shellmates_status\` to check whether you have unread messages or pending intros.
2. If this is your first time, run \`shellmates_set_profile\` with your name, country, languages, stacks, interests, and matching modes.
3. Run \`shellmates_publish\`, then \`shellmates_scan\` to find people.
4. Use \`shellmates_intro\` to send an intro. Use \`shellmates_inbox\` and \`shellmates_accept\` for incoming intros.

When first-time profile fields are missing, ask for them with Claude Code's AskQuestionTool instead of a free-form checklist. Keep each question short and collect only the fields needed for \`shellmates_set_profile\`.

## Chat

- Run \`shellmates_open\` to view the current chat.
- Ask for \`shellmates_coach\` when you want reply direction or tone help.
- Call \`shellmates_send\` only with exact text the user wants to send.
- Use \`shellmates_end\`, \`shellmates_block\`, or \`shellmates_report\` for safety and cleanup.

## Reopen This Session

If you close the Terminal window, reopen Shellmates with:

\`\`\`bash
${NPX_CMD} open
\`\`\`

Configured relay: ${endpoint}
`;
}

export function setupShellmates(argv: string[], env: NodeJS.ProcessEnv = process.env): string {
  const selection = selectionFromArgs(argv, env);
  mkdirSync(selection.shellmatesHome, { recursive: true });
  if (selection.mode === "local" && selection.localFolder) mkdirSync(selection.localFolder, { recursive: true });

  const serverEnv: Record<string, string> = { TL_HOME: selection.shellmatesHome };
  if (selection.token) serverEnv.TL_RELAY_ACCESS_TOKEN = selection.token;
  const config = {
    mcpServers: {
      [CHANNEL_SERVER_NAME]: {
        command: "npx",
        args: channelArgs(selection),
        env: serverEnv,
      },
    },
  };
  const configPath = join(selection.shellmatesDir, ".mcp.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  writeFileSync(join(selection.shellmatesDir, "CLAUDE.md"), onboardingGuide(selection));

  const endpoint = selection.mode === "local" ? selection.localFolder! : selection.serverUrl!;
  return [
    "Shellmates session configured",
    `  session directory : ${selection.shellmatesDir}`,
    `  channel config    : ${configPath}  (server: ${CHANNEL_SERVER_NAME})`,
    `  Shellmates home   : ${selection.shellmatesHome}`,
    `  relay mode        : ${selection.label} (${endpoint})`,
    "",
    "Open the Shellmates channel session:",
    `  ${NPX_CMD} open`,
    "",
    "Single-command start:",
    `  ${NPX_CMD} start`,
  ].join("\n");
}

export function openShellmates(argv: string[], env: NodeJS.ProcessEnv = process.env): string {
  const { flags } = parsePackageArgs(argv);
  const shellmatesDir = stringFlag(flags, "dir") || env.SHELLMATES_DIR || join(envHome(env), "shellmates");
  const configPath = join(shellmatesDir, ".mcp.json");
  const claudeCmd = [
    "claude",
    "--mcp-config",
    JSON.stringify(configPath),
    "--dangerously-load-development-channels",
    CLAUDE_CHANNEL_PROMPT,
  ].join(" ");
  const command = `cd ${JSON.stringify(shellmatesDir)} && ${claudeCmd}`;
  const prefix = existsSync(configPath)
    ? "Open the Shellmates channel session:"
    : `Shellmates is not configured yet. Run \`${NPX_CMD} setup\` first, or run \`${NPX_CMD} start\`.`;
  const approvalHint =
    "If Claude Code asks to approve the project MCP server, approve `shellmates-channel` to enable live channel messages.";

  if (flags.print === true) return `${prefix}\n  ${command}\n\n${approvalHint}`;

  if (process.platform === "darwin" && existsSync("/usr/bin/osascript")) {
    const script = [
      'tell application "Terminal"',
      "  activate",
      `  do script ${JSON.stringify(command)}`,
      "end tell",
    ].join("\n");
    const res = spawnSync("/usr/bin/osascript", [], { input: script, encoding: "utf8" });
    if (res.status === 0) return `Opened the Shellmates channel session in Terminal.\n${approvalHint}`;
  }

  return `${prefix}\n  ${command}\n\n${approvalHint}`;
}

export function startShellmates(argv: string[], env: NodeJS.ProcessEnv = process.env): string {
  const setupText = setupShellmates(argv, env);
  const openText = openShellmates(argv, env);
  return `${setupText}\n\n${openText}`;
}

export const PACKAGE_HELP = `Shellmates package commands
  setup [--server url | --private url | --local-folder path] [--token token]
      Configure the isolated Claude Code channel session. Defaults to the public Shellmates relay.
  open [--print]
      Open the configured Shellmates channel session.
  start [setup flags] [--print]
      Configure, then open the Shellmates channel session.
  sm-channel [--server url | --local-folder path] [--token token] [--home path]
      Run the Shellmates MCP channel server. Usually launched by Claude Code.
  sm-mcp [--server url | --local-folder path] [--token token]
      Run the count-only coding-session MCP server.
  sm-relay
      Run a self-hosted Shellmates relay/directory server. Configure with TL_RELAY_* env vars.`;
