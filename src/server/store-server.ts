// Filesystem-backed persistence for the relay/directory server: profile cards
// (directory/), per-recipient envelope inboxes (relay/), and an aggregate
// analytics document. All writes are atomic (temp file + rename) and analytics
// flushes are batched off the request hot path.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { Envelope, PresenceInfo, ProfileCard } from "../core/types.js";
import { isAgentId, isPrefixedId } from "../core/util.js";

export interface ServerStoreConfig {
  root: string;
  envelopeTtlMs: number;
  inboxMax: number;
}

export interface ServerPublicStats {
  updated_at: string;
  users_attempted_total: number;
  users_by_country: { country_code: string; users: number }[];
  online_users: number;
  recently_seen_users: number;
  active_conversations: number;
  active_chat_users: number;
  storage: { cards: number; inboxes: number; envelopes: number };
}

interface AnalyticsFile {
  agents: Record<string, { country_code: string; first_seen_at: string; last_seen_at: string }>;
  conversations: Record<string, { participants: [string, string]; started_at: string; last_seen_at: string }>;
  presence: Record<string, { last_seen_at: string }>;
}

function atomicWrite(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
}

// Bounds on the analytics document so it cannot grow without limit (notably via the
// unauthenticated POST /relay path). Stale records TTL-expire; survivors are hard-capped.
const ANALYTICS_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const MAX_TRACKED_AGENTS = 50_000;
const MAX_TRACKED_PRESENCE = 50_000;
const MAX_TRACKED_CONVERSATIONS = 50_000;

function capByLastSeen<T extends { last_seen_at: string }>(map: Record<string, T>, max: number): boolean {
  const keys = Object.keys(map);
  if (keys.length <= max) return false;
  keys.sort((a, b) => Date.parse(map[a]!.last_seen_at) - Date.parse(map[b]!.last_seen_at));
  for (const k of keys.slice(0, keys.length - max)) delete map[k];
  return true;
}

export class ServerStore {
  readonly directoryDir: string;
  readonly relayDir: string;
  readonly analyticsPath: string;
  private analytics: AnalyticsFile;
  private analyticsDirty = false;

  constructor(private readonly cfg: ServerStoreConfig) {
    this.directoryDir = join(cfg.root, "directory");
    this.relayDir = join(cfg.root, "relay");
    this.analyticsPath = join(cfg.root, "analytics.json");
    mkdirSync(this.directoryDir, { recursive: true });
    mkdirSync(this.relayDir, { recursive: true });
    this.analytics = this.loadAnalytics();
  }

  private loadAnalytics(): AnalyticsFile {
    if (!existsSync(this.analyticsPath)) return { agents: {}, conversations: {}, presence: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.analyticsPath, "utf8")) as Partial<AnalyticsFile>;
      return {
        agents: parsed.agents && typeof parsed.agents === "object" ? parsed.agents : {},
        conversations: parsed.conversations && typeof parsed.conversations === "object" ? parsed.conversations : {},
        presence: parsed.presence && typeof parsed.presence === "object" ? parsed.presence : {},
      };
    } catch {
      return { agents: {}, conversations: {}, presence: {} };
    }
  }

  /**
   * Mark analytics as needing a write. The actual disk flush is batched (see flush()) so the
   * request hot path never pays a full-document synchronous serialize+fsync per observation.
   */
  private markAnalyticsDirty(): void {
    this.analyticsDirty = true;
  }

  /** Persist analytics to disk only if dirty. Driven by a flush timer and called on shutdown. */
  flush(): void {
    if (!this.analyticsDirty) return;
    this.analyticsDirty = false;
    atomicWrite(this.analyticsPath, JSON.stringify(this.analytics, null, 2));
  }

  // ── directory ───────────────────────────────────────────────────────
  private cardPath(agentId: string): string {
    if (!isAgentId(agentId)) throw new Error(`invalid agent_id: ${agentId}`);
    return join(this.directoryDir, `${agentId}.json`);
  }

  putCard(card: ProfileCard): void {
    atomicWrite(this.cardPath(card.owner), JSON.stringify(card));
  }

  getCard(agentId: string): ProfileCard | null {
    if (!isAgentId(agentId)) return null;
    const p = this.cardPath(agentId);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as ProfileCard;
    } catch {
      return null;
    }
  }

  deleteCard(agentId: string): void {
    if (!isAgentId(agentId)) return;
    const p = this.cardPath(agentId);
    if (existsSync(p)) rmSync(p);
  }

  /**
   * Paginate the directory of profile cards, skipping expired ones and applying optional
   * mode/country filters. `cursor` is the file-index offset of the next unscanned card;
   * `nextCursor` is null when the directory has been fully scanned.
   */
  listCards(
    opts: { limit?: number; mode?: string; country?: string; cursor?: string } = {},
    now: Date = new Date(),
  ): { cards: ProfileCard[]; nextCursor: string | null } {
    if (!existsSync(this.directoryDir)) return { cards: [], nextCursor: null };
    const limit = Math.max(1, Math.min(opts.limit ?? 500, 2000));
    const allFiles = readdirSync(this.directoryDir).filter((f) => f.endsWith(".json")).sort();
    const offset = opts.cursor ? Math.max(0, Number.parseInt(opts.cursor, 10) || 0) : 0;
    const out: ProfileCard[] = [];
    // Read forward from the cursor until `limit` cards pass the filters (or files run out),
    // so a filtered query returns a full page instead of advancing the cursor by `limit`
    // raw files and forcing the pager through many near-empty pages.
    let i = offset;
    for (; i < allFiles.length && out.length < limit; i++) {
      try {
        const card = JSON.parse(readFileSync(join(this.directoryDir, allFiles[i]!), "utf8")) as ProfileCard;
        if (card.expires_at && Date.parse(card.expires_at) <= now.getTime()) continue;
        if (opts.mode && !(card.matching_modes ?? []).includes(opts.mode as never)) continue;
        if (opts.country && card.country?.toLowerCase() !== opts.country.toLowerCase()) continue;
        out.push(card);
      } catch {
        /* skip unreadable/corrupt card files */
      }
    }
    const nextCursor = i < allFiles.length ? String(i) : null;
    return { cards: out, nextCursor };
  }

  // ── relay ───────────────────────────────────────────────────────────
  private inboxDir(agentId: string): string {
    if (!isAgentId(agentId)) throw new Error(`invalid agent_id: ${agentId}`);
    return join(this.relayDir, agentId);
  }

  private envPath(agentId: string, envId: string): string {
    if (!isPrefixedId(envId, "env")) throw new Error(`invalid envelope id: ${envId}`);
    return join(this.inboxDir(agentId), `${envId}.json`);
  }

  /**
   * Store an envelope in the recipient's inbox. Returns false (without writing) when the inbox
   * is already at inboxMax and this is a new envelope id, so a flood cannot grow an inbox without
   * bound; re-delivering an existing id always overwrites in place.
   */
  putEnvelope(env: Envelope): boolean {
    const dir = this.inboxDir(env.to);
    mkdirSync(dir, { recursive: true });
    const path = this.envPath(env.to, env.id);
    const exists = existsSync(path);
    if (!exists && this.inboxCount(env.to) >= this.cfg.inboxMax) return false;
    atomicWrite(path, JSON.stringify(env));
    return true;
  }

  private inboxCount(agentId: string): number {
    const dir = this.inboxDir(agentId);
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((f) => f.endsWith(".json")).length;
  }

  /** Return a recipient's envelopes oldest-first, lazily deleting any past envelopeTtlMs or unreadable. */
  listEnvelopes(agentId: string, now: Date = new Date()): Envelope[] {
    const dir = this.inboxDir(agentId);
    if (!existsSync(dir)) return [];
    const out: { env: Envelope; mtime: number }[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const p = join(dir, f);
      try {
        const st = statSync(p);
        if (now.getTime() - st.mtimeMs > this.cfg.envelopeTtlMs) {
          rmSync(p);
          continue;
        }
        const env = JSON.parse(readFileSync(p, "utf8")) as Envelope;
        out.push({ env, mtime: st.mtimeMs });
      } catch {
        try {
          rmSync(p);
        } catch {
          /* noop */
        }
      }
    }
    out.sort((a, b) => a.mtime - b.mtime);
    return out.map((x) => x.env);
  }

  /** Remove a single envelope (e.g. after the recipient acks it); no-op on malformed ids. */
  deleteEnvelope(agentId: string, envId: string): void {
    if (!isAgentId(agentId) || !isPrefixedId(envId, "env")) return;
    const p = this.envPath(agentId, envId);
    if (existsSync(p)) rmSync(p);
  }

  // Record an agent sighting for analytics, preserving first_seen_at and bumping last_seen_at.
  // Country code is normalized to ZZ unless it is a valid ISO 3166-1 alpha-2 pair.
  observeAgent(agentId: string, countryCode: string, now: Date = new Date()): void {
    if (!isAgentId(agentId)) return;
    const ts = now.toISOString();
    const cc = /^[A-Z]{2}$/.test(countryCode) ? countryCode : "ZZ";
    const prev = this.analytics.agents[agentId];
    this.analytics.agents[agentId] = {
      country_code: cc,
      first_seen_at: prev?.first_seen_at ?? ts,
      last_seen_at: ts,
    };
    this.markAnalyticsDirty();
  }

  observeEnvelope(env: Envelope, senderCountryCode: string, now: Date = new Date()): void {
    this.observeAgent(env.from, senderCountryCode, now);
    // conversation_id is attacker-controlled on the unauthenticated POST /relay path; only
    // track well-formed ids so a missing/garbage value cannot become a stray map key (sec-01).
    if (!isPrefixedId(env.conversation_id, "chat")) return;
    const ts = now.toISOString();
    if (env.type === "intro_accept" || env.type === "message") {
      this.analytics.conversations[env.conversation_id] = {
        participants: [env.from, env.to],
        started_at: this.analytics.conversations[env.conversation_id]?.started_at ?? ts,
        last_seen_at: ts,
      };
      this.markAnalyticsDirty();
      return;
    }
    if (env.type === "end" || env.type === "intro_decline") {
      delete this.analytics.conversations[env.conversation_id];
      this.markAnalyticsDirty();
    }
  }

  observePresence(agentId: string, now: Date = new Date()): void {
    if (!isAgentId(agentId)) return;
    this.analytics.presence[agentId] = { last_seen_at: now.toISOString() };
    this.markAnalyticsDirty();
  }

  presenceFor(agentId: string, onlineTtlMs: number, recentTtlMs: number, now: Date = new Date()): PresenceInfo {
    const seen = this.analytics.presence[agentId]?.last_seen_at;
    if (!seen) return { status: "offline" };
    const ageMs = now.getTime() - Date.parse(seen);
    if (!Number.isFinite(ageMs) || ageMs < 0) return { status: "offline" };
    const base = { last_seen_at: seen, age_seconds: Math.floor(ageMs / 1000) };
    if (ageMs <= onlineTtlMs) return { status: "online", ...base };
    if (ageMs <= recentTtlMs) return { status: "recently_seen", ...base };
    return { status: "offline", ...base };
  }

  presenceMap(agentIds: string[], onlineTtlMs: number, recentTtlMs: number, now: Date = new Date()): Record<string, PresenceInfo> {
    const out: Record<string, PresenceInfo> = {};
    for (const id of agentIds) out[id] = this.presenceFor(id, onlineTtlMs, recentTtlMs, now);
    return out;
  }

  publicStats(activeConversationTtlMs: number, now: Date = new Date(), onlineTtlMs = 60_000, recentTtlMs = 10 * 60_000): ServerPublicStats {
    const nowMs = now.getTime();
    let changed = false;
    for (const [id, conv] of Object.entries(this.analytics.conversations)) {
      if (nowMs - Date.parse(conv.last_seen_at) > activeConversationTtlMs) {
        delete this.analytics.conversations[id];
        changed = true;
      }
    }
    if (changed) this.markAnalyticsDirty();

    const countries = new Map<string, number>();
    for (const agent of Object.values(this.analytics.agents)) {
      countries.set(agent.country_code, (countries.get(agent.country_code) ?? 0) + 1);
    }
    const activeUsers = new Set<string>();
    for (const conv of Object.values(this.analytics.conversations)) {
      activeUsers.add(conv.participants[0]);
      activeUsers.add(conv.participants[1]);
    }
    let onlineUsers = 0;
    let recentlySeenUsers = 0;
    for (const id of Object.keys(this.analytics.presence)) {
      const p = this.presenceFor(id, onlineTtlMs, recentTtlMs, now);
      if (p.status === "online") onlineUsers++;
      if (p.status === "online" || p.status === "recently_seen") recentlySeenUsers++;
    }
    const storage = this.stats();
    return {
      updated_at: now.toISOString(),
      users_attempted_total: Object.keys(this.analytics.agents).length,
      users_by_country: [...countries.entries()]
        .map(([country_code, users]) => ({ country_code, users }))
        .sort((a, b) => b.users - a.users || a.country_code.localeCompare(b.country_code)),
      online_users: onlineUsers,
      recently_seen_users: recentlySeenUsers,
      active_conversations: Object.keys(this.analytics.conversations).length,
      active_chat_users: activeUsers.size,
      storage,
    };
  }

  // Sweep expired profile cards (past expires_at) and stale envelopes (older than envelopeTtlMs
  // by mtime), then prune the analytics maps. Returns counts of what was removed.
  gc(now: Date = new Date()): { cardsRemoved: number; envelopesRemoved: number } {
    let cardsRemoved = 0;
    let envelopesRemoved = 0;
    if (existsSync(this.directoryDir)) {
      for (const f of readdirSync(this.directoryDir)) {
        if (!f.endsWith(".json")) continue;
        const p = join(this.directoryDir, f);
        try {
          const card = JSON.parse(readFileSync(p, "utf8")) as ProfileCard;
          if (card.expires_at && Date.parse(card.expires_at) <= now.getTime()) {
            rmSync(p);
            cardsRemoved++;
          }
        } catch {
          /* noop */
        }
      }
    }
    if (existsSync(this.relayDir)) {
      for (const agent of readdirSync(this.relayDir)) {
        const dir = join(this.relayDir, agent);
        let stat;
        try {
          stat = statSync(dir);
        } catch {
          continue;
        }
        if (!stat.isDirectory()) continue;
        for (const f of readdirSync(dir)) {
          if (!f.endsWith(".json")) continue;
          const p = join(dir, f);
          try {
            if (now.getTime() - statSync(p).mtimeMs > this.cfg.envelopeTtlMs) {
              rmSync(p);
              envelopesRemoved++;
            }
          } catch {
            /* noop */
          }
        }
      }
    }
    this.pruneAnalytics(now);
    return { cardsRemoved, envelopesRemoved };
  }

  /** TTL-expire then hard-cap the analytics maps so they cannot grow without bound (sec-01). */
  private pruneAnalytics(now: Date = new Date()): void {
    const cutoff = now.getTime() - ANALYTICS_TTL_MS;
    let changed = false;
    for (const [id, a] of Object.entries(this.analytics.agents)) {
      if (Date.parse(a.last_seen_at) < cutoff) {
        delete this.analytics.agents[id];
        changed = true;
      }
    }
    for (const [id, p] of Object.entries(this.analytics.presence)) {
      if (Date.parse(p.last_seen_at) < cutoff) {
        delete this.analytics.presence[id];
        changed = true;
      }
    }
    changed = capByLastSeen(this.analytics.agents, MAX_TRACKED_AGENTS) || changed;
    changed = capByLastSeen(this.analytics.presence, MAX_TRACKED_PRESENCE) || changed;
    changed = capByLastSeen(this.analytics.conversations, MAX_TRACKED_CONVERSATIONS) || changed;
    if (changed) this.markAnalyticsDirty();
  }

  stats(): { cards: number; inboxes: number; envelopes: number } {
    let cards = 0;
    let inboxes = 0;
    let envelopes = 0;
    if (existsSync(this.directoryDir)) cards = readdirSync(this.directoryDir).filter((f) => f.endsWith(".json")).length;
    if (existsSync(this.relayDir)) {
      for (const agent of readdirSync(this.relayDir)) {
        const dir = join(this.relayDir, agent);
        try {
          if (!statSync(dir).isDirectory()) continue;
          inboxes++;
          envelopes += readdirSync(dir).filter((f) => f.endsWith(".json")).length;
        } catch {
          /* noop */
        }
      }
    }
    return { cards, inboxes, envelopes };
  }
}
