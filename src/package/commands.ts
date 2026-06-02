import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_PUBLIC_RELAY = "https://shellmates.parktaeyoung.com/relay";
const CHANNEL_SERVER_NAME = "shellmates-channel";
const CLAUDE_CHANNEL_CMD = `claude --dangerously-load-development-channels server:${CHANNEL_SERVER_NAME}`;
const PACKAGE_NAME = "@taeyoung1005/shellmates";

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

  const endpoint = selection.mode === "local" ? selection.localFolder! : selection.serverUrl!;
  return [
    "Shellmates session configured",
    `  session directory : ${selection.shellmatesDir}`,
    `  channel config    : ${configPath}  (server: ${CHANNEL_SERVER_NAME})`,
    `  Shellmates home   : ${selection.shellmatesHome}`,
    `  relay mode        : ${selection.label} (${endpoint})`,
    "",
    "Open the Shellmates channel session:",
    `  shellmates open`,
    "",
    "Single-command start:",
    `  shellmates start`,
  ].join("\n");
}

export function openShellmates(argv: string[], env: NodeJS.ProcessEnv = process.env): string {
  const { flags } = parsePackageArgs(argv);
  const shellmatesDir = stringFlag(flags, "dir") || env.SHELLMATES_DIR || join(envHome(env), "shellmates");
  const command = `cd ${JSON.stringify(shellmatesDir)} && ${CLAUDE_CHANNEL_CMD}`;
  const configPath = join(shellmatesDir, ".mcp.json");
  const prefix = existsSync(configPath)
    ? "Open the Shellmates channel session:"
    : "Shellmates is not configured yet. Run `shellmates setup` first, or run `shellmates start`.";

  if (flags.print === true) return `${prefix}\n  ${command}`;

  if (process.platform === "darwin" && existsSync("/usr/bin/osascript")) {
    const script = [
      'tell application "Terminal"',
      "  activate",
      `  do script ${JSON.stringify(command)}`,
      "end tell",
    ].join("\n");
    const res = spawnSync("/usr/bin/osascript", [], { input: script, encoding: "utf8" });
    if (res.status === 0) return "Opened the Shellmates channel session in Terminal.";
  }

  return `${prefix}\n  ${command}`;
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
