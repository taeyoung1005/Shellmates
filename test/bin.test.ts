import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
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
