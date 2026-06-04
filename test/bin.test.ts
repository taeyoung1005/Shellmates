import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Regression: CLI main() must run when invoked through an npm-style symlink.
test("CLI runs main() when invoked through a symlink (npm bin scenario)", () => {
  const cliTs = resolve(fileURLToPath(new URL("../src/cli/cli.ts", import.meta.url)));
  const dir = mkdtempSync(join(tmpdir(), "tl-bin-"));
  const link = join(dir, "tl-link.ts");
  symlinkSync(cliTs, link);
  const out = execFileSync(process.execPath, ["--import", "tsx", link, "help"], {
    encoding: "utf8",
    env: { ...process.env, TL_HOME: join(dir, "h"), TL_NET: join(dir, "n"), TL_SOUND: "0" },
  });
  assert.match(out, /init/);
  assert.match(out, /commands/);
});

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const shellmatesCliTs = resolve(fileURLToPath(new URL("../src/cli/cli.ts", import.meta.url)));
const shellmatesCommands = [
  "shellmates.md",
  "shellmates-status.md",
  "shellmates-open.md",
  "shellmates-scan.md",
  "shellmates-intro.md",
  "shellmates-reply.md",
  "shellmates-profile.md",
];

test("Shellmates command and skill entrypoints are present and map to Shellmates tools", () => {
  for (const name of shellmatesCommands) {
    const path = join(repoRoot, "commands", name);
    assert.ok(existsSync(path), `missing command file: ${name}`);
    const body = readFileSync(path, "utf8");
    assert.match(body, /Shellmates|shellmates_/i, `command should mention Shellmates or shellmates tool: ${name}`);
  }

  const skill = readFileSync(join(repoRoot, "agents", "skills", "shellmates", "SKILL.md"), "utf8");
  for (const tool of ["shellmates_status", "shellmates_open", "shellmates_scan", "shellmates_intro", "shellmates_coach", "shellmates_send", "shellmates_set_profile", "shellmates_publish"]) {
    assert.match(skill, new RegExp(tool), `skill should document ${tool}`);
  }
  assert.match(skill, /shellmates_send.*exact text to send|exact text to send.*shellmates_send/s);
});

test("install-agent copies Shellmates commands and shellmates skill into HOME", () => {
  const home = mkdtempSync(join(tmpdir(), "sm-install-home-"));
  const out = execFileSync("bash", [join(repoRoot, "scripts", "install-agent.sh")], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
  assert.match(out, /Shellmates install complete/);
  for (const name of shellmatesCommands) {
    assert.ok(existsSync(join(home, ".claude", "commands", name)), `command not installed: ${name}`);
  }
  const installedSkill = join(home, ".agents", "skills", "shellmates", "SKILL.md");
  assert.ok(existsSync(installedSkill), "shellmates skill should be installed");
  assert.match(readFileSync(installedSkill, "utf8"), /shellmates_scan/);
});

function runSetupShellmates(args: string[], extraEnv: NodeJS.ProcessEnv = {}): { out: string; config: { mcpServers: Record<string, { env: Record<string, string> }> } } {
  const home = mkdtempSync(join(tmpdir(), "sm-setup-home-"));
  const out = execFileSync("bash", [join(repoRoot, "scripts", "setup-shellmates.sh"), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, HOME: home, ...extraEnv },
  });
  const config = JSON.parse(readFileSync(join(home, "shellmates", ".mcp.json"), "utf8")) as {
    mcpServers: Record<string, { env: Record<string, string> }>;
  };
  return { out, config };
}

function runPackageCli(args: string[], extraEnv: NodeJS.ProcessEnv = {}): { out: string; home: string } {
  const home = mkdtempSync(join(tmpdir(), "sm-pkg-home-"));
  const out = execFileSync(process.execPath, ["--import", "tsx", shellmatesCliTs, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, HOME: home, ...extraEnv },
  });
  return { out, home };
}

function channelEnv(config: { mcpServers: Record<string, { env: Record<string, string> }> }): Record<string, string> {
  const server = config.mcpServers["shellmates-channel"];
  assert.ok(server, "setup should write shellmates-channel config");
  return server.env;
}

test("setup-shellmates --server connects the channel session to an operator relay", () => {
  const { out, config } = runSetupShellmates(["--server", "https://relay.example.com", "--token", "devtoken"]);
  const env = channelEnv(config);
  assert.equal(env.TL_SERVER, "https://relay.example.com");
  assert.equal(env.TL_RELAY_ACCESS_TOKEN, "devtoken");
  assert.equal(env.TL_NET, undefined);
  assert.match(out, /relay mode\s+: public network \(https:\/\/relay\.example\.com\)/);
});

test("setup-shellmates --private connects the channel session to a self-hosted relay", () => {
  const { out, config } = runSetupShellmates(["--private", "http://192.168.0.10:8787"]);
  const env = channelEnv(config);
  assert.equal(env.TL_SERVER, "http://192.168.0.10:8787");
  assert.equal(env.TL_NET, undefined);
  assert.match(out, /relay mode\s+: private relay \(http:\/\/192\.168\.0\.10:8787\)/);
});

test("setup-shellmates --local-folder keeps the offline shared-folder transport explicit", () => {
  const localNet = join(mkdtempSync(join(tmpdir(), "sm-net-")), "net");
  const { out, config } = runSetupShellmates(["--local-folder", localNet]);
  const env = channelEnv(config);
  assert.equal(env.TL_NET, localNet);
  assert.equal(env.TL_SERVER, undefined);
  assert.match(out, /relay mode\s+: local shared folder/);
});

test("setup-shellmates --network uses the configured public relay URL", () => {
  const { out, config } = runSetupShellmates(["--network"], { SHELLMATES_PUBLIC_RELAY_URL: "https://relay.shellmates.test" });
  const env = channelEnv(config);
  assert.equal(env.TL_SERVER, "https://relay.shellmates.test");
  assert.equal(env.TL_NET, undefined);
  assert.match(out, /relay mode\s+: public network \(https:\/\/relay\.shellmates\.test\)/);
});

test("setup-shellmates defaults to the public network relay", () => {
  const { out, config } = runSetupShellmates([], { SHELLMATES_PUBLIC_RELAY_URL: "https://relay.default.test" });
  const env = channelEnv(config);
  assert.equal(env.TL_SERVER, "https://relay.default.test");
  assert.equal(env.TL_NET, undefined);
  assert.match(out, /relay mode\s+: public network \(https:\/\/relay\.default\.test\)/);
});

test("package CLI setup writes npx-based channel config for the public relay", () => {
  const { out, home } = runPackageCli(["setup", "--server", "https://relay.example.com", "--token", "devtoken"]);
  const config = JSON.parse(readFileSync(join(home, "shellmates", ".mcp.json"), "utf8")) as {
    mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  };
  const server = config.mcpServers["shellmates-channel"];
  assert.ok(server, "setup should write shellmates-channel config");
  assert.equal(server.command, "npx");
  assert.deepEqual(server.args, ["-y", "@taeyoung1005/shellmates", "sm-channel", "--server", "https://relay.example.com"]);
  assert.equal(server.env.TL_HOME, join(home, "shellmates", "home"));
  assert.equal(server.env.TL_RELAY_ACCESS_TOKEN, "devtoken");
  assert.equal(server.env.TL_SERVER, undefined);
  assert.match(out, /Shellmates session configured/);
  assert.match(out, /relay mode\s+: public network \(https:\/\/relay\.example\.com\)/);
});

test("package CLI setup writes visible onboarding instructions for the opened Shellmates session", () => {
  const { home } = runPackageCli(["setup", "--server", "https://relay.example.com"]);
  const guidePath = join(home, "shellmates", "CLAUDE.md");
  assert.ok(existsSync(guidePath), "setup should write CLAUDE.md for the opened Claude Code session");
  const guide = readFileSync(guidePath, "utf8");
  assert.match(guide, /Welcome to Shellmates/);
  assert.match(guide, /shellmates_status/);
  assert.match(guide, /shellmates_set_profile/);
  assert.match(guide, /shellmates_scan/);
  assert.match(guide, /shellmates_send/);
  assert.match(guide, /AskQuestionTool/);
  assert.match(guide, /npx -y @taeyoung1005\/shellmates open/);
  assert.match(guide, /https:\/\/relay\.example\.com/);
});

test("package CLI setup defaults to the public relay without clone-time env", () => {
  const { out, home } = runPackageCli(["setup"], { SHELLMATES_PUBLIC_RELAY_URL: "https://relay.default.test" });
  const config = JSON.parse(readFileSync(join(home, "shellmates", ".mcp.json"), "utf8")) as {
    mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  };
  const server = config.mcpServers["shellmates-channel"];
  assert.ok(server, "setup should write shellmates-channel config");
  assert.deepEqual(server.args, ["-y", "@taeyoung1005/shellmates", "sm-channel", "--server", "https://relay.default.test"]);
  assert.match(out, /relay mode\s+: public network \(https:\/\/relay\.default\.test\)/);
  assert.match(out, /npx -y @taeyoung1005\/shellmates open/);
  assert.match(out, /npx -y @taeyoung1005\/shellmates start/);
  assert.doesNotMatch(out, /\n  shellmates (open|start)\n/);
});

test("package CLI setup supports private relay and local folder modes", () => {
  const privateRun = runPackageCli(["setup", "--private", "http://intranet:8787"]);
  const privateConfig = JSON.parse(readFileSync(join(privateRun.home, "shellmates", ".mcp.json"), "utf8")) as {
    mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  };
  const privateServer = privateConfig.mcpServers["shellmates-channel"];
  assert.ok(privateServer, "private setup should write shellmates-channel config");
  assert.deepEqual(privateServer.args, ["-y", "@taeyoung1005/shellmates", "sm-channel", "--server", "http://intranet:8787"]);
  assert.match(privateRun.out, /relay mode\s+: private relay \(http:\/\/intranet:8787\)/);

  const localPath = join(mkdtempSync(join(tmpdir(), "sm-local-net-")), "net");
  const localRun = runPackageCli(["setup", "--local-folder", localPath]);
  const localConfig = JSON.parse(readFileSync(join(localRun.home, "shellmates", ".mcp.json"), "utf8")) as {
    mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  };
  const localServer = localConfig.mcpServers["shellmates-channel"];
  assert.ok(localServer, "local setup should write shellmates-channel config");
  assert.deepEqual(localServer.args, ["-y", "@taeyoung1005/shellmates", "sm-channel", "--local-folder", localPath]);
  assert.match(localRun.out, /relay mode\s+: local shared folder/);
});

test("package CLI open --print shows the Claude channel command without opening Terminal", () => {
  const { out } = runPackageCli(["open", "--print"]);
  assert.match(
    out,
    /cd .*shellmates"? && claude --mcp-config .*\.mcp\.json"? --dangerously-load-development-channels server:shellmates-channel/,
  );
  assert.doesNotMatch(out, /cat CLAUDE\.md/);
  assert.match(out, /approve `shellmates-channel`/);
  assert.match(out, /--dangerously-load-development-channels server:shellmates-channel/);
});

test("package CLI start --print configures then shows the Claude channel command", () => {
  const { out, home } = runPackageCli(["start", "--server", "https://relay.example.com", "--print"]);
  assert.ok(existsSync(join(home, "shellmates", ".mcp.json")), "start should configure the channel session");
  assert.match(out, /relay mode\s+: public network \(https:\/\/relay\.example\.com\)/);
  assert.match(out, /claude --mcp-config .*\.mcp\.json"? --dangerously-load-development-channels server:shellmates-channel/);
});

test("package CLI reset unpublishes before removing the isolated local session", () => {
  const home = mkdtempSync(join(tmpdir(), "sm-reset-home-"));
  const localNet = join(mkdtempSync(join(tmpdir(), "sm-reset-net-")), "net");
  const run = (args: string[]) =>
    execFileSync(process.execPath, ["--import", "tsx", shellmatesCliTs, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, HOME: home, TL_SOUND: "0" },
    });

  run(["setup", "--local-folder", localNet]);
  const shellmatesHome = join(home, "shellmates", "home");
  const cliEnv = { ...process.env, TL_HOME: shellmatesHome, TL_NET: localNet, TL_SOUND: "0" };
  execFileSync(process.execPath, ["--import", "tsx", shellmatesCliTs, "init"], { cwd: repoRoot, env: cliEnv });
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      shellmatesCliTs,
      "profile",
      "--name",
      "Reset Test",
      "--country",
      "Korea",
      "--langs",
      "Korean,English",
      "--stacks",
      "TypeScript",
      "--interests",
      "AI,Startups",
      "--modes",
      "builder",
    ],
    { cwd: repoRoot, env: cliEnv },
  );
  execFileSync(process.execPath, ["--import", "tsx", shellmatesCliTs, "publish"], { cwd: repoRoot, env: cliEnv });
  assert.equal(readdirSync(join(localNet, "directory")).filter((f) => f.endsWith(".json")).length, 1);

  const out = run(["reset"]);

  assert.match(out, /Shellmates reset complete/);
  assert.match(out, /public profile\s+: removed from directory/);
  assert.equal(readdirSync(join(localNet, "directory")).filter((f) => f.endsWith(".json")).length, 0);
  assert.equal(existsSync(join(home, "shellmates")), false);
});
