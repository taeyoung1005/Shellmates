import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;

const ACTIVE_SURFACES = [
  "README.md",
  "SETUP.md",
  "commands/shellmates.md",
  "commands/shellmates-status.md",
  "commands/shellmates-open.md",
  "commands/shellmates-scan.md",
  "commands/shellmates-intro.md",
  "commands/shellmates-reply.md",
  "commands/shellmates-profile.md",
  "agents/skills/shellmates/SKILL.md",
  "scripts/install-agent.sh",
  "scripts/setup-shellmates.sh",
  "scripts/shellmates.sh",
  "src/channel/payload.ts",
  "src/channel/server.ts",
  "src/cli/cli.ts",
  "src/core/coaching.ts",
  "src/core/engine.ts",
  "src/core/messaging.ts",
  "src/mcp/full.ts",
  "src/mcp/server.ts",
];

test("active Shellmates user-facing surfaces are English-only", () => {
  const offenders = ACTIVE_SURFACES.flatMap((file) => {
    const text = readFileSync(join(ROOT, file), "utf8");
    return text
      .split("\n")
      .map((line, i) => ({ file, line: i + 1, text: line }))
      .filter((row) => {
        if (!row.file.startsWith("src/")) return true;
        const trimmed = row.text.trim();
        return !(trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"));
      })
      .filter((row) => HANGUL.test(row.text));
  });
  assert.deepEqual(offenders, []);
});
