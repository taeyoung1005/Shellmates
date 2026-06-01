// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
import { signAuth } from "./crypto.js";
import { verifyCard } from "./profile.js";
import { syncFetch, type SyncResponse } from "./sync-fetch.js";
import type { Transport, DirectoryQuery, PolledEnvelope } from "./transport.js";
import type { Envelope, Identity, ProfileCard, PublicProfileCard } from "./types.js";
import { isAgentId } from "./util.js";

export class HttpTransport implements Transport {
  /**
   * Internal implementation note.
   * Internal implementation note.
   * Internal implementation note.
   * Internal implementation note.
   */
  private readonly readTimeoutMs: number | undefined;
  /**
   * Internal implementation note.
   * Internal implementation note.
   * Internal implementation note.
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

  // Internal implementation note.
  private baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json", ...extra };
    if (this.accessToken) h["x-tl-access"] = this.accessToken; // admission gate
    return h;
  }

  /** Internal implementation note. */
  private authHeaders(method: string, path: string): Record<string, string> {
    const id = this.getIdentity();
    if (!id) throw new Error("This operation requires an identity; run init first.");
    return this.baseHeaders({ authorization: signAuth(id, method, path) });
  }

  private url(path: string): string {
    return this.baseUrl + path;
  }

  /** Internal implementation note. */
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
    if (res.status >= 300) throw new Error(`Card publish failed: ${res.status} ${res.body.slice(0, 200)}`);
  }

  revokeCard(agentId: string): void {
    if (!isAgentId(agentId)) return;
    const path = `/directory/${agentId}`;
    // Internal implementation note.
    this.safeFetch(this.url(path), { method: "DELETE", headers: this.authHeaders("DELETE", path), timeoutMs: this.readTimeoutMs });
  }

  scanCards(now: Date = new Date(), query?: DirectoryQuery): PublicProfileCard[] {
    const pageSize = query?.limit ?? 500;
    const MAX_PAGES = 100;
    const out: PublicProfileCard[] = [];
    let cursor: string | undefined;
    let more = false;
    // Internal implementation note.
    // Internal implementation note.
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
      // Internal implementation note.
      const cards = Array.isArray(data?.cards) ? (data!.cards as ProfileCard[]) : [];
      // Internal implementation note.
      for (const c of cards) {
        try {
          if (verifyCard(c, now).ok) out.push(c);
        } catch {
          /* Internal implementation note. */
        }
      }
      const next = typeof data?.next_cursor === "string" ? data.next_cursor : null;
      if (!next) {
        more = false;
        break;
      }
      cursor = next;
      more = true;
    }
    if (more) {
      process.stderr.write(
        `[tl] Directory scan hit the cap(${MAX_PAGES}pages, ~${MAX_PAGES * pageSize}cards). Increase --limit or narrow with mode/country filters.\n`,
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
    if (res.status >= 300) throw new Error(`Envelope send failed: ${res.status} ${res.body.slice(0, 200)}`);
  }

  pollEnvelopes(myAgentId: string): PolledEnvelope[] {
    const path = `/relay/${myAgentId}`;
    // Internal implementation note.
    const res = this.safeFetch(this.url(path), { method: "GET", headers: this.authHeaders("GET", path), timeoutMs: this.readTimeoutMs });
    if (!res || res.status >= 300) return [];
    const data = HttpTransport.parseJson(res) as { envelopes?: unknown } | null;
    // Internal implementation note.
    const envelopes = Array.isArray(data?.envelopes) ? (data!.envelopes as Envelope[]) : [];
    // Internal implementation note.
    return envelopes.filter((env) => env && typeof env === "object" && typeof env.id === "string").map((env) => ({ env, ref: env.id }));
  }

  deleteEnvelope(ref: string): void {
    const id = this.getIdentity();
    if (!id) return;
    const path = `/relay/${id.agent_id}/${ref}`;
    // Internal implementation note.
    this.safeFetch(this.url(path), { method: "DELETE", headers: this.authHeaders("DELETE", path), timeoutMs: this.readTimeoutMs });
  }
}
