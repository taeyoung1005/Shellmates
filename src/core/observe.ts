// Phase 2F — "제품의 혼": 로컬 코딩 에이전트 기록을 관찰해 성향 프로필 초안을 만든다.
//  - 데이터는 전부 로컬에서만 처리(프라이버시). 결과는 "초안"일 뿐, 사용자가 publish해야 공개.
//  - LLM(TL_LLM) 가능 시 요약, 아니면 결정적 휴리스틱(키워드 빈도)으로 폴백 → 외부 의존 없이도 동작.
//  - 컨텍스트 방화벽: 이 작업은 별도 `tl` 세션에서 사용자의 "자기 데이터"로 프로필을 만드는 것이며,
//    코딩 세션으로 소개팅 데이터를 주입하는 것과 무관하다(방향이 반대, 안전).
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultLlm, extractJson, type LlmFn } from "./llm.js";
import type { MatchingMode, ProfileAnswers } from "./types.js";

// 기술 스택 어휘(표기 보존). 대소문자 무시 매칭.
const STACK_VOCAB = [
  "TypeScript", "JavaScript", "Python", "Rust", "Go", "Java", "Kotlin", "Swift", "Ruby", "C++", "C#",
  "React", "Next.js", "Vue", "Svelte", "Angular", "Node", "Deno", "Bun",
  "Django", "Flask", "FastAPI", "Rails", "Express", "NestJS",
  "PostgreSQL", "MySQL", "SQLite", "Redis", "MongoDB", "GraphQL",
  "Docker", "Kubernetes", "Terraform", "AWS", "GCP", "Azure",
  "Tailwind", "WebAssembly", "Electron",
];

// 관심사 어휘 → 표준 표기. 여러 동의어를 한 관심사로 묶는다.
const INTEREST_VOCAB: { label: string; terms: string[] }[] = [
  { label: "AI Products", terms: ["ai product", "llm", "gpt", "claude", "agent", "rag", "prompt", "에이전트", "인공지능"] },
  { label: "AI Agents", terms: ["agentic", "mcp", "tool use", "autonomous agent", "subagent"] },
  { label: "Startups", terms: ["startup", "founder", "mvp", "fundrais", "saas", "스타트업", "창업"] },
  { label: "Side Projects", terms: ["side project", "weekend project", "hobby", "사이드"] },
  { label: "Design", terms: ["design system", "figma", "ux", "ui ", "css", "tailwind", "디자인"] },
  { label: "Open Source", terms: ["open source", "github", "oss", "npm publish", "오픈소스"] },
  { label: "Security", terms: ["security", "crypto", "encryption", "auth", "보안", "암호"] },
  { label: "DevOps", terms: ["devops", "ci/cd", "kubernetes", "docker", "deploy", "infra"] },
  { label: "Data", terms: ["data pipeline", "etl", "analytics", "ml ", "dataset", "데이터"] },
];

const HANGUL = /[가-힣]/;
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
  roots?: string[]; // 기본: ~/.claude/projects, ~/.codex
  llm?: LlmFn; // 주입(테스트). 기본 defaultLlm()
  maxChars?: number; // 코퍼스 상한
  maxFiles?: number; // 스캔 파일 상한
}

/** jsonl 한 줄 객체에서 (role, text) 추출. 다양한 transcript 스키마에 방어적으로 대응. */
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

/** 파일을 최대 maxBytes까지만 읽는다(거대 transcript를 통째로 메모리에 올리지 않도록). */
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

/** roots 아래 *.jsonl 파일을 최근 수정순으로 모아 user/assistant 텍스트 코퍼스를 만든다. */
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

  // 파일당 읽기 상한(거대 세션 로그가 통째로 로드되어 OOM 나는 것 방지). maxChars의 4배까지만.
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

/** 결정적 휴리스틱: 키워드 빈도로 stacks/interests/languages/style 추정. */
function heuristicDraft(corpus: string, userText: string): ProfileAnswers {
  const lc = corpus.toLowerCase();

  // 어휘 중복 방어 + 표기 dedupe
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

  // 대화 스타일: 질문 비율 + 평균 길이로 거칠게 추정
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

/** 로컬 기록을 관찰해 프로필 초안 생성. LLM 가능 시 요약, 아니면 휴리스틱. */
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
      note: "관찰할 로컬 기록을 찾지 못했습니다. 플래그로 직접 프로필을 채우세요.",
    };
  }

  const llm = opts.llm ?? defaultLlm();
  const viaLlm = llmDraft(corpus, llm);
  if (viaLlm) {
    return { draft: viaLlm, source: "llm", scannedFiles, chars: corpus.length, note: "LLM 요약 기반 초안(검토 후 publish)." };
  }
  return {
    draft: heuristicDraft(corpus, userText),
    source: "heuristic",
    scannedFiles,
    chars: corpus.length,
    note: "휴리스틱(키워드 빈도) 기반 초안. TL_LLM 설정 시 LLM 요약 사용. 검토 후 publish.",
  };
}
