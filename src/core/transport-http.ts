// HttpTransport — 네트워크 relay/directory 서버 호출. syncFetch로 동기 동작.
// 보안 불변(PLAN §0,§3.2):
//  - inbox 읽기/삭제(GET/DELETE /relay)는 TL-Sig 서명 인증(소유자만).
//  - 서버가 주는 카드/봉투는 그대로 믿지 않고 클라가 최종 재검증(verifyCard, 봉투 서명은 messaging에서).
import { signAuth } from "./crypto.js";
import { verifyCard } from "./profile.js";
import { syncFetch, type SyncResponse } from "./sync-fetch.js";
import type { Transport, DirectoryQuery, PolledEnvelope } from "./transport.js";
import type { Envelope, Identity, ProfileCard, PublicProfileCard } from "./types.js";
import { isAgentId } from "./util.js";

export class HttpTransport implements Transport {
  /**
   * 읽기/best-effort 호출의 timeout(ms). undefined면 syncFetch 기본(15s).
   * 채널 서버처럼 이벤트 루프 블로킹이 tool call을 막으면 안 되는 경우, 짧게(env TL_HTTP_TIMEOUT_MS) 설정해
   * relay 행(hang) 시 폴/스캔이 빨리 실패하도록 한다(이들은 idempotent — 타임아웃해도 데이터 분기 없음).
   * CLI/데몬은 미설정 → 기존 15s 불변(회귀 없음).
   */
  private readonly readTimeoutMs: number | undefined;
  /**
   * 쓰기(publishCard/sendEnvelope) timeout. 짧게 잡으면 위험: 서버가 봉투를 *저장한 뒤* 응답이 늦어
   * 클라가 타임아웃 throw하면 → 상대는 받았는데 발신자는 "실패"로 처리해 outbound 미기록(state divergence).
   * 따라서 쓰기는 읽기 timeout을 따르지 않고 별도(기본 15s, env TL_HTTP_WRITE_TIMEOUT_MS)로 넉넉히 둔다.
   */
  private readonly writeTimeoutMs: number | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly getIdentity: () => Identity | null,
    private readonly accessToken?: string,
  ) {
    const rt = Number(process.env.TL_HTTP_TIMEOUT_MS);
    this.readTimeoutMs = Number.isFinite(rt) && rt > 0 ? Math.floor(rt) : undefined;
    const wt = Number(process.env.TL_HTTP_WRITE_TIMEOUT_MS);
    this.writeTimeoutMs = Number.isFinite(wt) && wt > 0 ? Math.floor(wt) : undefined;
  }

  // ── 헤더 ────────────────────────────────────────────────────────────
  private baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json", ...extra };
    if (this.accessToken) h["x-tl-access"] = this.accessToken; // admission gate
    return h;
  }

  /** 서명 인증 헤더 포함(소유자 전용 엔드포인트). path는 query 제외 pathname. */
  private authHeaders(method: string, path: string): Record<string, string> {
    const id = this.getIdentity();
    if (!id) throw new Error("이 작업은 신원이 필요합니다(먼저 init).");
    return this.baseHeaders({ authorization: signAuth(id, method, path) });
  }

  private url(path: string): string {
    return this.baseUrl + path;
  }

  /** 읽기/best-effort용: 네트워크 전송 실패(연결 거부 등)를 삼키고 null 반환. 데몬/scan이 크래시하지 않도록. */
  private safeFetch(url: string, opts: Parameters<typeof syncFetch>[1]): SyncResponse | null {
    try {
      return syncFetch(url, opts);
    } catch {
      return null;
    }
  }

  private static parseJson(res: SyncResponse): unknown {
    try {
      return JSON.parse(res.body);
    } catch {
      return null;
    }
  }

  // ── directory ───────────────────────────────────────────────────────
  publishCard(card: ProfileCard): void {
    const path = `/directory/${card.owner}`;
    const res = syncFetch(this.url(path), {
      method: "PUT",
      headers: this.baseHeaders(),
      body: JSON.stringify(card),
      timeoutMs: this.writeTimeoutMs,
    });
    if (res.status >= 300) throw new Error(`카드 게시 실패: ${res.status} ${res.body.slice(0, 200)}`);
  }

  revokeCard(agentId: string): void {
    if (!isAgentId(agentId)) return;
    const path = `/directory/${agentId}`;
    // best-effort: 서버 미가용/인증 실패해도 로컬 unpublish는 진행되어야 함(404/401/네트워크 무시).
    this.safeFetch(this.url(path), { method: "DELETE", headers: this.authHeaders("DELETE", path), timeoutMs: this.readTimeoutMs });
  }

  scanCards(now: Date = new Date(), query?: DirectoryQuery): PublicProfileCard[] {
    const pageSize = query?.limit ?? 500;
    const MAX_PAGES = 100;
    const out: PublicProfileCard[] = [];
    let cursor: string | undefined;
    let more = false; // 루프가 페이지 상한 때문에 끝났는지(더 남았는지) 추적
    // cursor 페이지네이션으로 디렉토리를 순회(PLAN §10). 안전 상한 100페이지(~limit*100장);
    // 그보다 큰 디렉토리는 잘리며, 그 경우 stderr로 경고(무음 절단 아님).
    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams();
      qs.set("limit", String(pageSize));
      if (query?.mode) qs.set("mode", query.mode);
      if (query?.country) qs.set("country", query.country);
      if (cursor) qs.set("cursor", cursor);
      const res = this.safeFetch(this.url(`/directory?${qs.toString()}`), { method: "GET", headers: this.baseHeaders(), timeoutMs: this.readTimeoutMs });
      if (!res || res.status >= 300) {
        more = false;
        break;
      }
      const data = HttpTransport.parseJson(res) as { cards?: unknown; next_cursor?: unknown } | null;
      // 적대/버그 서버가 cards를 배열이 아닌 값으로 줘도 크래시하지 않도록 방어.
      const cards = Array.isArray(data?.cards) ? (data!.cards as ProfileCard[]) : [];
      // 클라 최종 재검증(서버 보증 X). per-card try/catch — 악성 카드 한 장이 scan 전체를 throw시키지 않도록.
      for (const c of cards) {
        try {
          if (verifyCard(c, now).ok) out.push(c);
        } catch {
          /* 손상 카드 무시 */
        }
      }
      const next = typeof data?.next_cursor === "string" ? data.next_cursor : null;
      if (!next) {
        more = false;
        break;
      }
      cursor = next;
      more = true; // 다음 페이지 존재 — 루프가 상한으로 끝나면 잘린 것
    }
    if (more) {
      process.stderr.write(
        `[tl] 디렉토리 스캔이 상한(${MAX_PAGES}페이지, ~${MAX_PAGES * pageSize}장)에서 잘렸습니다. 더 큰 --limit 또는 mode/country 필터로 좁히세요.\n`,
      );
    }
    return out;
  }

  lookupCard(agentId: string, now: Date = new Date()): PublicProfileCard | null {
    if (!isAgentId(agentId)) return null;
    const res = this.safeFetch(this.url(`/directory/${agentId}`), { method: "GET", headers: this.baseHeaders(), timeoutMs: this.readTimeoutMs });
    if (!res || res.status >= 300) return null;
    const data = HttpTransport.parseJson(res) as { card?: ProfileCard } | null;
    const card = data?.card;
    return card && verifyCard(card, now).ok ? card : null;
  }

  // ── relay ───────────────────────────────────────────────────────────
  sendEnvelope(env: Envelope): void {
    const path = `/relay/${env.to}`;
    const res = syncFetch(this.url(path), {
      method: "POST",
      headers: this.baseHeaders(),
      body: JSON.stringify(env),
      timeoutMs: this.writeTimeoutMs,
    });
    if (res.status >= 300) throw new Error(`봉투 전송 실패: ${res.status} ${res.body.slice(0, 200)}`);
  }

  pollEnvelopes(myAgentId: string): PolledEnvelope[] {
    const path = `/relay/${myAgentId}`;
    // best-effort: 네트워크 일시 실패에 데몬/poll이 크래시하지 않도록 [] 반환.
    const res = this.safeFetch(this.url(path), { method: "GET", headers: this.authHeaders("GET", path), timeoutMs: this.readTimeoutMs });
    if (!res || res.status >= 300) return [];
    const data = HttpTransport.parseJson(res) as { envelopes?: unknown } | null;
    // 비배열 응답 방어(적대/버그 서버) — poll/데몬 크래시 방지.
    const envelopes = Array.isArray(data?.envelopes) ? (data!.envelopes as Envelope[]) : [];
    // Http ref = envelope id (DELETE /relay/:me/:id 로 ack). id 형식이 이상한 봉투는 제외.
    return envelopes.filter((env) => env && typeof env === "object" && typeof env.id === "string").map((env) => ({ env, ref: env.id }));
  }

  deleteEnvelope(ref: string): void {
    const id = this.getIdentity();
    if (!id) return;
    const path = `/relay/${id.agent_id}/${ref}`;
    // best-effort ack: 실패해도 로컬 seen_env dedupe가 중복을 막으므로 무시.
    this.safeFetch(this.url(path), { method: "DELETE", headers: this.authHeaders("DELETE", path), timeoutMs: this.readTimeoutMs });
  }
}
