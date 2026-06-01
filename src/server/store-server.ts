// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { Envelope, ProfileCard } from "../core/types.js";
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
  active_conversations: number;
  active_chat_users: number;
  storage: { cards: number; inboxes: number; envelopes: number };
}

interface AnalyticsFile {
  agents: Record<string, { country_code: string; first_seen_at: string; last_seen_at: string }>;
  conversations: Record<string, { participants: [string, string]; started_at: string; last_seen_at: string }>;
}

function atomicWrite(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
}

export class ServerStore {
  readonly directoryDir: string;
  readonly relayDir: string;
  readonly analyticsPath: string;
  private analytics: AnalyticsFile;

  constructor(private readonly cfg: ServerStoreConfig) {
    this.directoryDir = join(cfg.root, "directory");
    this.relayDir = join(cfg.root, "relay");
    this.analyticsPath = join(cfg.root, "analytics.json");
    mkdirSync(this.directoryDir, { recursive: true });
    mkdirSync(this.relayDir, { recursive: true });
    this.analytics = this.loadAnalytics();
  }

  private loadAnalytics(): AnalyticsFile {
    if (!existsSync(this.analyticsPath)) return { agents: {}, conversations: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.analyticsPath, "utf8")) as Partial<AnalyticsFile>;
      return {
        agents: parsed.agents && typeof parsed.agents === "object" ? parsed.agents : {},
        conversations: parsed.conversations && typeof parsed.conversations === "object" ? parsed.conversations : {},
      };
    } catch {
      return { agents: {}, conversations: {} };
    }
  }

  private saveAnalytics(): void {
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
   * Internal implementation note.
   * Internal implementation note.
   * Internal implementation note.
   */
  listCards(
    opts: { limit?: number; mode?: string; country?: string; cursor?: string } = {},
    now: Date = new Date(),
  ): { cards: ProfileCard[]; nextCursor: string | null } {
    if (!existsSync(this.directoryDir)) return { cards: [], nextCursor: null };
    const limit = Math.max(1, Math.min(opts.limit ?? 500, 2000));
    const allFiles = readdirSync(this.directoryDir).filter((f) => f.endsWith(".json")).sort();
    const offset = opts.cursor ? Math.max(0, Number.parseInt(opts.cursor, 10) || 0) : 0;
    const slice = allFiles.slice(offset, offset + limit);
    const out: ProfileCard[] = [];
    for (const f of slice) {
      try {
        const card = JSON.parse(readFileSync(join(this.directoryDir, f), "utf8")) as ProfileCard;
        if (card.expires_at && Date.parse(card.expires_at) <= now.getTime()) continue;
        if (opts.mode && !(card.matching_modes ?? []).includes(opts.mode as never)) continue;
        if (opts.country && card.country?.toLowerCase() !== opts.country.toLowerCase()) continue;
        out.push(card);
      } catch {
        /* Internal implementation note. */
      }
    }
    const consumed = offset + slice.length;
    const nextCursor = consumed < allFiles.length ? String(consumed) : null;
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
   * Internal implementation note.
   * Internal implementation note.
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

  /** Internal implementation note. */
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

  /** Internal implementation note. */
  deleteEnvelope(agentId: string, envId: string): void {
    if (!isAgentId(agentId) || !isPrefixedId(envId, "env")) return;
    const p = this.envPath(agentId, envId);
    if (existsSync(p)) rmSync(p);
  }

  // Internal implementation note.
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
    this.saveAnalytics();
  }

  observeEnvelope(env: Envelope, senderCountryCode: string, now: Date = new Date()): void {
    this.observeAgent(env.from, senderCountryCode, now);
    const ts = now.toISOString();
    if (env.type === "intro_accept" || env.type === "message") {
      this.analytics.conversations[env.conversation_id] = {
        participants: [env.from, env.to],
        started_at: this.analytics.conversations[env.conversation_id]?.started_at ?? ts,
        last_seen_at: ts,
      };
      this.saveAnalytics();
      return;
    }
    if (env.type === "end" || env.type === "intro_decline") {
      delete this.analytics.conversations[env.conversation_id];
      this.saveAnalytics();
    }
  }

  publicStats(activeConversationTtlMs: number, now: Date = new Date()): ServerPublicStats {
    const nowMs = now.getTime();
    let changed = false;
    for (const [id, conv] of Object.entries(this.analytics.conversations)) {
      if (nowMs - Date.parse(conv.last_seen_at) > activeConversationTtlMs) {
        delete this.analytics.conversations[id];
        changed = true;
      }
    }
    if (changed) this.saveAnalytics();

    const countries = new Map<string, number>();
    for (const agent of Object.values(this.analytics.agents)) {
      countries.set(agent.country_code, (countries.get(agent.country_code) ?? 0) + 1);
    }
    const activeUsers = new Set<string>();
    for (const conv of Object.values(this.analytics.conversations)) {
      activeUsers.add(conv.participants[0]);
      activeUsers.add(conv.participants[1]);
    }
    const storage = this.stats();
    return {
      updated_at: now.toISOString(),
      users_attempted_total: Object.keys(this.analytics.agents).length,
      users_by_country: [...countries.entries()]
        .map(([country_code, users]) => ({ country_code, users }))
        .sort((a, b) => b.users - a.users || a.country_code.localeCompare(b.country_code)),
      active_conversations: Object.keys(this.analytics.conversations).length,
      active_chat_users: activeUsers.size,
      storage,
    };
  }

  // Internal implementation note.
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
    return { cardsRemoved, envelopesRemoved };
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
