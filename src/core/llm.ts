// LLM 호출 추상화 — Phase 2F의 (1) 관찰 기반 프로필 요약, (2) 별도 세션 코칭에 사용.
// 컨텍스트 방화벽: 코칭 프롬프트에는 "소개팅 데이터만" 시드된다(호출부 책임). 여기선 전송만 담당.
//
// 백엔드(TL_LLM):
//   - "claude" : 로컬 headless `claude -p <prompt>` (별도 프로세스/세션)
//   - "codex"  : 로컬 headless `codex exec <prompt>`
//   - "api"    : Anthropic Messages API (ANTHROPIC_API_KEY) — syncFetch 사용
//   - 미설정/"none"/실패 : null 반환 → 호출부가 결정적 휴리스틱으로 폴백
import { execFileSync } from "node:child_process";
import { syncFetch } from "./sync-fetch.js";

export type LlmFn = (prompt: string, opts?: { system?: string; maxTokens?: number }) => string | null;

const DEFAULT_MODEL = "claude-sonnet-4-6";

function callClaudeCli(prompt: string, system?: string): string | null {
  try {
    const args = ["-p", prompt];
    if (system) args.push("--append-system-prompt", system);
    const out = execFileSync("claude", args, { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function callCodexCli(prompt: string): string | null {
  try {
    const full = prompt;
    const out = execFileSync("codex", ["exec", full], { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function callApi(prompt: string, system: string | undefined, maxTokens: number): string | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = syncFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.TL_LLM_MODEL || DEFAULT_MODEL,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: prompt }],
      }),
      timeoutMs: 60000,
    });
    if (res.status >= 300) return null;
    const data = JSON.parse(res.body) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

/** TL_LLM 환경에 따른 기본 LLM 호출자. 미설정/실패 시 null(→ 휴리스틱 폴백). */
export function defaultLlm(env: NodeJS.ProcessEnv = process.env): LlmFn {
  const backend = (env.TL_LLM || "none").toLowerCase();
  if (backend === "none" || backend === "") return () => null;
  return (prompt, opts) => {
    const maxTokens = opts?.maxTokens ?? 1024;
    switch (backend) {
      case "claude":
        return callClaudeCli(prompt, opts?.system);
      case "codex":
        return callCodexCli(opts?.system ? `${opts.system}\n\n${prompt}` : prompt);
      case "api":
        return callApi(prompt, opts?.system, maxTokens);
      default:
        return null;
    }
  };
}

/** 응답 텍스트에서 첫 JSON 객체를 추출(코드펜스/잡설 둘러싸여 있어도). 실패 시 null. */
export function extractJson(text: string): unknown | null {
  if (!text) return null;
  // ```json ... ``` 펜스 우선
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
