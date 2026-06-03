import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isTextFile(file: string): boolean {
  const bytes = readFileSync(join(ROOT, file));
  return !bytes.includes(0);
}

test("GitHub-bound files and landing pages contain no Korean user-facing text", () => {
  const files = [...trackedFiles(), "landing.template.html", "landing.html"]
    .filter((file) => existsSync(join(ROOT, file)))
    .filter(isTextFile);
  const offenders = files.flatMap((file) => {
    const text = readFileSync(join(ROOT, file), "utf8");
    return text
      .split("\n")
      .map((line, i) => ({ file, line: i + 1, text: line }))
      .filter((row) => HANGUL.test(row.text));
  });
  assert.deepEqual(offenders, []);
});

test("landing distinguishes relay health from human online presence", () => {
  const landing = readFileSync(join(ROOT, "landing.template.html"), "utf8");
  const worker = readFileSync(join(ROOT, "worker/public/index.html"), "utf8");
  for (const html of [landing, worker]) {
    assert.match(html, /Relay online/);
    assert.match(html, /Online Now/);
    assert.match(html, /online_users/);
  }
});
