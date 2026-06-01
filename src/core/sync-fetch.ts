// 동기 HTTP 브리지 — Engine/CLI/테스트 API를 동기로 유지하기 위한 blocking fetch.
//
// 왜 동기인가: 기존 엔진/CLI/데몬/테스트 API는 모두 동기다(예: `engine.intro(...)`가 즉시 결과 반환).
// HttpTransport를 위해 전부 async로 바꾸면 37개 기존 테스트가 깨진다(PLAN §4: API 불변).
// 그래서 자식 node 프로세스를 spawn해 fetch를 수행하고 결과를 동기적으로 받아온다.
// child_process.execFileSync는 메인 이벤트루프를 블로킹하므로 worker/SharedArrayBuffer 같은
// 동시성 함정이 없다(견고함 우선). 자식 startup ~50ms 오버헤드는 대화형 CLI에선 무시 가능.
import { execFileSync } from "node:child_process";

// 자식 프로세스에서 실행되는 인라인 스크립트. stdin(JSON 요청) → fetch → stdout(JSON 응답).
// tsx(src)·dist(js) 양쪽에서 파일 경로 의존 없이 동작하도록 -e 인라인으로 전달한다.
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

/** 동기 HTTP 요청. 네트워크/전송 실패 시 throw. HTTP 상태코드는 그대로 반환(호출자가 판단). */
export function syncFetch(url: string, opts: SyncRequestOptions = {}): SyncResponse {
  const { method = "GET", headers = {}, body, timeoutMs = 15000 } = opts;
  const input = JSON.stringify({ url, method, headers, body, timeoutMs });
  let out: string;
  try {
    out = execFileSync(process.execPath, ["-e", HELPER], {
      input,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024, // inbox(최대 1000봉투)도 한 번에 받을 수 있게 넉넉히
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
