// Optional, pluggable LLM backend used for local agent-assisted features.
//
// Selected via the TL_LLM env var: "claude"/"codex" shell out to the
// respective CLI, "api" calls the Anthropic Messages API directly, and
// "none" (the default) disables LLM calls entirely. Every backend returns
// null on any failure so callers can degrade gracefully.
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
    const out = execFileSync("codex", ["exec", prompt], { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
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

/** Build an LlmFn dispatching to the backend named by env.TL_LLM; returns a no-op (() => null) when disabled. */
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

/** Best-effort extraction of a JSON object from free-form LLM output; returns null if none parses. */
export function extractJson(text: string): unknown | null {
  if (!text) return null;
  // Prefer the contents of a ```json fenced block if present, else scan the raw text.
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
