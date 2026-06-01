// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultLlm, extractJson, type LlmFn } from "./llm.js";
import type { MatchingMode, ProfileAnswers } from "./types.js";

// Internal implementation note.
const STACK_VOCAB = [
  "TypeScript", "JavaScript", "Python", "Rust", "Go", "Java", "Kotlin", "Swift", "Ruby", "C++", "C#",
  "React", "Next.js", "Vue", "Svelte", "Angular", "Node", "Deno", "Bun",
  "Django", "Flask", "FastAPI", "Rails", "Express", "NestJS",
  "PostgreSQL", "MySQL", "SQLite", "Redis", "MongoDB", "GraphQL",
  "Docker", "Kubernetes", "Terraform", "AWS", "GCP", "Azure",
  "Tailwind", "WebAssembly", "Electron",
];

// Internal implementation note.
const INTEREST_VOCAB: { label: string; terms: string[] }[] = [
  { label: "AI Products", terms: ["ai product", "llm", "gpt", "claude", "agent", "rag", "prompt", "agent", "artificial intelligence"] },
  { label: "AI Agents", terms: ["agentic", "mcp", "tool use", "autonomous agent", "subagent"] },
  { label: "Startups", terms: ["startup", "founder", "mvp", "fundrais", "saas", "startup", "founding"] },
  { label: "Side Projects", terms: ["side project", "weekend project", "hobby", "side project"] },
  { label: "Design", terms: ["design system", "figma", "ux", "ui ", "css", "tailwind", "design"] },
  { label: "Open Source", terms: ["open source", "github", "oss", "npm publish", "open source"] },
  { label: "Security", terms: ["security", "crypto", "encryption", "auth", "security", "cryptography"] },
  { label: "DevOps", terms: ["devops", "ci/cd", "kubernetes", "docker", "deploy", "infra"] },
  { label: "Data", terms: ["data pipeline", "etl", "analytics", "ml ", "dataset", "data"] },
];

const HANGUL = /\p{Script=Hangul}/u;
const HIRAGANA_KATAKANA = /[぀-ヿ]/;
const HAN = /[一-鿿]/;

export interface ObserveResult {
  draft: ProfileAnswers;
  source: "llm" | "heuristic";
  scannedFiles: number;
  chars: number;
  note: string;
}

export interface ObserveOptions {
  roots?: string[];
  llm?: LlmFn;
  maxChars?: number;
  maxFiles?: number;
}

/** Internal implementation note. */
function extractLineTexts(obj: unknown): { role: string; text: string }[] {
  if (!obj || typeof obj !== "object") return [];
  const o = obj as Record<string, unknown>;
  const out: { role: string; text: string }[] = [];
  const msg = (o.message ?? o) as Record<string, unknown>;
  const role = String((msg.role ?? o.role ?? o.type ?? "unknown") as string);
  const content = msg.content ?? o.content ?? o.text;
  const pushText = (t: unknown): void => {
    if (typeof t === "string" && t.trim()) out.push({ role, text: t });
  };
  if (typeof content === "string") {
    pushText(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === "string") pushText(part);
      else if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") pushText(p.text);
      }
    }
  }
  return out;
}

/** Internal implementation note. */
function readBoundedUtf8(path: string, size: number, maxBytes: number): string {
  if (size <= maxBytes) return readFileSync(path, "utf8");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Internal implementation note. */
function collectCorpus(roots: string[], maxFiles: number, maxChars: number): { corpus: string; userText: string; scannedFiles: number } {
  const files: { path: string; mtime: number; size: number }[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 6 || files.length > maxFiles * 4) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (e.endsWith(".jsonl") || e.endsWith(".json")) files.push({ path: p, mtime: st.mtimeMs, size: st.size });
    }
  };
  for (const r of roots) if (existsSync(r)) walk(r, 0);
  files.sort((a, b) => b.mtime - a.mtime);

  // Internal implementation note.
  const perFileCap = Math.max(64 * 1024, maxChars * 4);
  const parts: string[] = [];
  const userParts: string[] = [];
  let chars = 0;
  let scannedFiles = 0;
  for (const f of files.slice(0, maxFiles)) {
    if (chars >= maxChars) break;
    let raw: string;
    try {
      raw = readBoundedUtf8(f.path, f.size, perFileCap);
    } catch {
      continue;
    }
    scannedFiles++;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }
      for (const { role, text } of extractLineTexts(obj)) {
        const snippet = text.slice(0, 2000);
        parts.push(snippet);
        if (/user|human/i.test(role)) userParts.push(snippet);
        chars += snippet.length;
        if (chars >= maxChars) break;
      }
      if (chars >= maxChars) break;
    }
  }
  return { corpus: parts.join("\n"), userText: userParts.join("\n"), scannedFiles };
}

function topMatches<T>(items: T[], scoreFn: (t: T) => number, n: number): T[] {
  return items
    .map((t) => ({ t, s: scoreFn(t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.t);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  const lower = haystack;
  const nlower = needle;
  for (;;) {
    const f = lower.indexOf(nlower, idx);
    if (f < 0) break;
    count++;
    idx = f + nlower.length;
  }
  return count;
}

/** Internal implementation note. */
function heuristicDraft(corpus: string, userText: string): ProfileAnswers {
  const lc = corpus.toLowerCase();

  // Internal implementation note.
  const uniqStacks = [...new Set(STACK_VOCAB)];
  const stacks = [...new Set(topMatches(uniqStacks, (s) => countOccurrences(lc, s.toLowerCase()), 6))];
  const interests = topMatches(
    INTEREST_VOCAB,
    (it) => it.terms.reduce((acc, term) => acc + countOccurrences(lc, term.toLowerCase()), 0),
    5,
  ).map((it) => it.label);

  const languages: string[] = [];
  if (HANGUL.test(corpus)) languages.push("Korean");
  if (HIRAGANA_KATAKANA.test(corpus)) languages.push("Japanese");
  if (HAN.test(corpus) && !HIRAGANA_KATAKANA.test(corpus) && !HANGUL.test(corpus)) languages.push("Chinese");
  if (/[a-z]{4,}/i.test(corpus)) languages.push("English");
  if (languages.length === 0) languages.push("English");

  // Internal implementation note.
  const userLines = userText.split("\n").filter(Boolean);
  const avgLen = userLines.length ? userLines.reduce((a, l) => a + l.length, 0) / userLines.length : 0;
  const questionRatio = userLines.length ? userLines.filter((l) => l.includes("?") || /[?？]/.test(l)).length / userLines.length : 0;
  let style = "direct, logical";
  if (questionRatio > 0.4) style = "curious, exploratory";
  else if (avgLen > 220) style = "thorough, detailed";
  else if (avgLen > 0 && avgLen < 60) style = "concise, direct";

  const modes: MatchingMode[] = ["dating", "builder"];

  const draft: ProfileAnswers = {
    country: HANGUL.test(corpus) ? "Korea" : "",
    languages,
    stacks: stacks.length ? stacks : [],
    interests: interests.length ? interests : [],
    communication_style: style,
    matching_modes: modes,
  };
  return draft;
}

const SYSTEM_PROMPT =
  "You analyze a developer's coding-assistant transcripts to draft a short dating/networking profile. " +
  "Output ONLY a JSON object with keys: country (string, may be empty), languages (string[]), stacks (string[]), " +
  "interests (string[]), communication_style (string), activity_hours (\"night\"|\"day\"|\"flexible\"|\"\"). " +
  "Be concise (<=6 stacks, <=5 interests). Never include secrets, tokens, file contents, or PII. Infer only high-level traits.";

function llmDraft(corpus: string, llm: LlmFn): ProfileAnswers | null {
  const prompt =
    "From the following (truncated, local) transcript excerpts, infer the developer's profile traits as JSON.\n\n" +
    "=== EXCERPTS START ===\n" +
    corpus.slice(0, 16000) +
    "\n=== EXCERPTS END ===\n\nReturn ONLY the JSON object.";
  const out = llm(prompt, { system: SYSTEM_PROMPT, maxTokens: 700 });
  if (!out) return null;
  const json = extractJson(out) as Partial<ProfileAnswers> | null;
  if (!json || typeof json !== "object") return null;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : []);
  const draft: ProfileAnswers = {
    country: typeof json.country === "string" ? json.country : "",
    languages: arr(json.languages).length ? arr(json.languages) : ["English"],
    stacks: arr(json.stacks),
    interests: arr(json.interests),
    communication_style: typeof json.communication_style === "string" ? json.communication_style : "direct, logical",
    matching_modes: ["dating", "builder"],
  };
  if (typeof json.activity_hours === "string" && json.activity_hours) draft.activity_hours = json.activity_hours;
  return draft;
}

/** Internal implementation note. */
export function observeProfile(opts: ObserveOptions = {}): ObserveResult {
  const roots = opts.roots ?? [join(homedir(), ".claude", "projects"), join(homedir(), ".codex")];
  const maxFiles = opts.maxFiles ?? 200;
  const maxChars = opts.maxChars ?? 24000;
  const { corpus, userText, scannedFiles } = collectCorpus(roots, maxFiles, maxChars);

  if (!corpus.trim()) {
    return {
      draft: { country: "", languages: ["English"], stacks: [], interests: [], communication_style: "direct, logical", matching_modes: ["dating", "builder"] },
      source: "heuristic",
      scannedFiles,
      chars: 0,
      note: "No local agent history found. Fill the profile manually with flags.",
    };
  }

  const llm = opts.llm ?? defaultLlm();
  const viaLlm = llmDraft(corpus, llm);
  if (viaLlm) {
    return { draft: viaLlm, source: "llm", scannedFiles, chars: corpus.length, note: "LLM-generated draft; review before publishing." };
  }
  return {
    draft: heuristicDraft(corpus, userText),
    source: "heuristic",
    scannedFiles,
    chars: corpus.length,
    note: "Heuristic draft based on keyword frequency. Set TL_LLM to use an LLM summary. Review before publishing.",
  };
}
