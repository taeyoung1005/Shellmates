// sync-fetch: a synchronous HTTP client.
//
// Some call sites need an HTTP response without awaiting a Promise (e.g. code
// paths that must stay fully synchronous). This bridges the async global
// fetch() to a blocking API by running fetch() inside a short-lived child Node
// process and blocking on it via execFileSync, exchanging a single JSON
// request/response over the child's stdin/stdout.
import { execFileSync } from "node:child_process";

// Source for the child process: reads a JSON request from stdin, performs the
// fetch with an AbortController timeout, and writes a JSON result to stdout.
const HELPER = `
let data = "";
process.stdin.on("data", (c) => (data += c));
process.stdin.on("end", async () => {
  let req;
  try { req = JSON.parse(data); } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: "bad request json" }));
    return;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs || 15000);
    const res = await fetch(req.url, {
      method: req.method || "GET",
      headers: req.headers || {},
      body: req.body,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const body = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    process.stdout.write(JSON.stringify({ ok: true, status: res.status, headers, body }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
  }
});
`;

export interface SyncRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface SyncResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Performs an HTTP request synchronously, blocking until the response (or an error) is returned. */
export function syncFetch(url: string, opts: SyncRequestOptions = {}): SyncResponse {
  const { method = "GET", headers = {}, body, timeoutMs = 15000 } = opts;
  const input = JSON.stringify({ url, method, headers, body, timeoutMs });
  let out: string;
  try {
    out = execFileSync(process.execPath, ["-e", HELPER], {
      input,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: timeoutMs + 5000,
    });
  } catch (e) {
    throw new Error(`syncFetch transport failure (${url}): ${(e as Error).message}`);
  }
  let parsed: { ok: boolean; status?: number; headers?: Record<string, string>; body?: string; error?: string };
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`syncFetch: malformed helper output for ${url}`);
  }
  if (!parsed.ok) throw new Error(`syncFetch (${url}): ${parsed.error}`);
  return { status: parsed.status ?? 0, headers: parsed.headers ?? {}, body: parsed.body ?? "" };
}
