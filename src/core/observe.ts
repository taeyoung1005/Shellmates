// Local "observe" pass: scans the user's own coding-assistant transcripts
// (~/.claude, ~/.codex JSON/JSONL) and drafts a profile from them, via an LLM
// when available and a keyword-frequency heuristic otherwise. All reading is
// local and read-only; nothing here leaves the machine.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultLlm, extractJson, type LlmFn } from "./llm.js";
import type { MatchingMode, ProfileAnswers } from "./types.js";

// Per-transcript-line snippet cap, and the overall corpus cap handed to the LLM draft prompt.
const SNIPPET_MAX_CHARS = 2000;
const LLM_CORPUS_MAX_CHARS = 16000;

// Known tech-stack labels the heuristic counts occurrences of in the corpus.
const STACK_VOCAB = [
  "TypeScript", "JavaScript", "Python", "Rust", "Go", "Java", "Kotlin", "Swift", "Ruby", "C++", "C#",
  "React", "Next.js", "Vue", "Svelte", "Angular", "Node", "Deno", "Bun",
  "Django", "Flask", "FastAPI", "Rails", "Express", "NestJS",
  "PostgreSQL", "MySQL", "SQLite", "Redis", "MongoDB", "GraphQL",
  "Docker", "Kubernetes", "Terraform", "AWS", "GCP", "Azure",
  "Tailwind", "WebAssembly", "Electron",
];

// Interest categories, each scored by the summed frequency of its trigger terms.
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

/** Pull (role, text) pairs from one transcript record, tolerating both the
 *  `{message:{role,content}}` wrapper and bare shapes, and string or array content. */
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

/** Read a file as UTF-8, but cap large files at their first `maxBytes` bytes
 *  to avoid loading huge transcripts into memory. */
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

/** Recursively gather .json/.jsonl transcripts under the roots, newest first,
 *  and accumulate their text snippets into a corpus (and a user-only subset)
 *  until the per-file and total char caps are hit. */
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

  // Generous byte budget per file: JSON overhead plus multi-byte chars mean far
  // more raw bytes than usable chars, so allow at least 64 KiB or 4x maxChars.
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
        const snippet = text.slice(0, SNIPPET_MAX_CHARS);
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

// Callers lower-case both corpus and needle before calling, so this is a plain
// non-overlapping substring count.
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  for (;;) {
    const f = haystack.indexOf(needle, idx);
    if (f < 0) break;
    count++;
    idx = f + needle.length;
  }
  return count;
}

/** LLM-free fallback: derive a profile from keyword frequency, script detection,
 *  and rough message-length/question-ratio style cues. */
function heuristicDraft(corpus: string, userText: string): ProfileAnswers {
  const lc = corpus.toLowerCase();

  // Pick the 6 most-mentioned stacks by case-insensitive occurrence count.
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

  // Infer communication style from the user's own lines: a high question ratio
  // reads as curious, long average length as thorough, short as concise.
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
    corpus.slice(0, LLM_CORPUS_MAX_CHARS) +
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

/** Entry point: collect the local transcript corpus and return a profile draft,
 *  preferring an LLM summary and falling back to the heuristic (or an empty draft
 *  when no history is found). */
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
