#!/usr/bin/env node
// Internal implementation note.
//
// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMainEntry } from "../core/entry.js";
import { verifyAuth } from "../core/crypto.js";
import { verifyCard } from "../core/profile.js";
import type { Envelope, ProfileCard } from "../core/types.js";
import { isAgentId, isPrefixedId } from "../core/util.js";
import { ServerStore } from "./store-server.js";

const SERVER_VERSION = "0.2.0";

export interface ServerConfig {
  host: string;
  port: number;
  basePath: string;
  dataRoot: string;
  open: boolean;
  accessToken: string | null; // X-TL-Access
  allowlist: Set<string> | null;
  maxEnvelopeBytes: number;
  maxCardBytes: number;
  inboxMax: number;
  envelopeTtlMs: number;
  rateMax: number;
  rateRelayPostMax: number;
  rateWindowMs: number;
  trustProxy: boolean;
  ipCountryMap: Map<string, string>;
  activeConversationTtlMs: number;
}

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function normalizeBasePath(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const normalized = withSlash.replace(/\/+$/, "");
  return normalized === "/" ? "" : normalized;
}

function stripBasePath(path: string, basePath: string): string {
  if (!basePath) return path;
  if (path === basePath) return "/";
  if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length);
  return path;
}

function parseIpCountryMap(raw: string | undefined): Map<string, string> {
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = new Map<string, string>();
    for (const [ipOrPrefix, country] of Object.entries(parsed)) {
      if (typeof country !== "string") continue;
      const code = country.trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) out.set(ipOrPrefix.trim(), code);
    }
    return out;
  } catch {
    return new Map();
  }
}

export function resolveServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  let allowlist: Set<string> | null = null;
  const allowPath = env.TL_RELAY_ALLOWLIST;
  if (allowPath && existsSync(allowPath)) {
    try {
      const arr = JSON.parse(readFileSync(allowPath, "utf8")) as string[];
      allowlist = new Set(arr.filter((x) => isAgentId(x)));
    } catch {
      allowlist = new Set();
    }
  }
  return {
    host: env.TL_RELAY_HOST || "127.0.0.1",
    port: envInt("TL_RELAY_PORT", envInt("PORT", 8787)),
    basePath: normalizeBasePath(env.TL_RELAY_BASE_PATH),
    dataRoot: resolve(env.TL_SERVER_DATA || "./serverData"),
    open: env.TL_RELAY_OPEN === "true",
    accessToken: env.TL_RELAY_ACCESS_TOKEN?.trim() || null,
    allowlist,
    maxEnvelopeBytes: envInt("TL_MAX_ENVELOPE_BYTES", 64 * 1024),
    maxCardBytes: envInt("TL_MAX_CARD_BYTES", 32 * 1024),
    inboxMax: envInt("TL_INBOX_MAX", 1000),
    envelopeTtlMs: envInt("TL_ENVELOPE_TTL_MS", 7 * 24 * 60 * 60 * 1000),
    rateMax: envInt("TL_RATE_MAX", 600),
    rateRelayPostMax: envInt("TL_RATE_RELAY_POST_MAX", 300),
    rateWindowMs: envInt("TL_RATE_WINDOW_MS", 60 * 1000),
    trustProxy: env.TL_TRUST_PROXY === "true",
    ipCountryMap: parseIpCountryMap(env.TL_IP_COUNTRY_MAP),
    activeConversationTtlMs: envInt("TL_ACTIVE_CHAT_TTL_MS", 24 * 60 * 60 * 1000),
  };
}

// Internal implementation note.
class RateLimiter {
  private hits = new Map<string, { count: number; windowStart: number }>();
  constructor(private windowMs: number) {}
  check(key: string, max: number, now: number): boolean {
    const rec = this.hits.get(key);
    if (!rec || now - rec.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: now });
      return true;
    }
    rec.count++;
    return rec.count <= max;
  }
  gc(now: number): void {
    for (const [k, v] of this.hits) if (now - v.windowStart >= this.windowMs * 2) this.hits.delete(k);
  }
}

export interface RunningServer {
  server: Server;
  port: number;
  store: ServerStore;
  close: () => Promise<void>;
}

interface Metrics {
  started_at: string;
  requests: number;
  rejected_admission: number;
  rejected_auth: number;
  rejected_rate: number;
  rejected_validation: number;
  envelopes_in: number;
  envelopes_acked: number;
  cards_published: number;
}

export function createApp(cfg: ServerConfig): { server: Server; store: ServerStore; metrics: Metrics; timers: NodeJS.Timeout[] } {
  const store = new ServerStore({ root: cfg.dataRoot, envelopeTtlMs: cfg.envelopeTtlMs, inboxMax: cfg.inboxMax });
  const rate = new RateLimiter(cfg.rateWindowMs);
  const seenNonces = new Map<string, number>();
  const metrics: Metrics = {
    started_at: new Date().toISOString(),
    requests: 0,
    rejected_admission: 0,
    rejected_auth: 0,
    rejected_rate: 0,
    rejected_validation: 0,
    envelopes_in: 0,
    envelopes_acked: 0,
    cards_published: 0,
  };

  const send = (res: ServerResponse, status: number, body: unknown): void => {
    const data = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json", "x-tl-relay": SERVER_VERSION });
    res.end(data);
  };

  const publicStatusHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  const sendPublicStatus = (res: ServerResponse, status: number, body: unknown): void => {
    const data = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json", "x-tl-relay": SERVER_VERSION, ...publicStatusHeaders });
    res.end(data);
  };

  // Internal implementation note.
  // Internal implementation note.
  // Internal implementation note.
  const clientIp = (req: IncomingMessage): string => {
    if (cfg.trustProxy) {
      const xff = req.headers["x-forwarded-for"]?.toString();
      if (xff) {
        const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
        const rightmost = parts[parts.length - 1];
        if (rightmost) return rightmost;
      }
    }
    return req.socket.remoteAddress || "unknown";
  };

  const normalizeIp = (ip: string): string => ip.replace(/^::ffff:/, "");

  const countryFromRequest = (req: IncomingMessage, ip: string): string => {
    // Internal implementation note.
    for (const h of ["cf-ipcountry", "x-vercel-ip-country", "fly-client-ip-country", "x-country-code"]) {
      const raw = req.headers[h]?.toString().trim().toUpperCase();
      if (raw && /^[A-Z]{2}$/.test(raw)) return raw;
    }
    const normalized = normalizeIp(ip);
    const exact = cfg.ipCountryMap.get(normalized) ?? cfg.ipCountryMap.get(ip);
    if (exact) return exact;
    for (const [prefix, code] of cfg.ipCountryMap) {
      if (prefix.endsWith("*") && normalized.startsWith(prefix.slice(0, -1))) return code;
      if (prefix.endsWith(".") && normalized.startsWith(prefix)) return code;
    }
    return "ZZ";
  };

  // Internal implementation note.
  // Internal implementation note.
  // Internal implementation note.
  const readBody = (req: IncomingMessage, maxBytes: number): Promise<string | null> =>
    new Promise((resolveBody) => {
      let size = 0;
      const chunks: Buffer[] = [];
      let over = false;
      let done = false;
      const hardCap = maxBytes * 4;
      const finish = (v: string | null): void => {
        if (done) return;
        done = true;
        resolveBody(v);
      };
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          over = true;
          chunks.length = 0;
          if (size > hardCap) {
            finish(null);
            req.destroy();
          }
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => finish(over ? null : Buffer.concat(chunks).toString("utf8")));
      req.on("error", () => finish(null));
    });

  // Internal implementation note.
  const requireOwner = (req: IncomingMessage, res: ServerResponse, method: string, path: string, agentId: string): boolean => {
    const auth = verifyAuth(req.headers["authorization"]?.toString(), method, path);
    if (!auth.ok || auth.agentId !== agentId) {
      metrics.rejected_auth++;
      send(res, 401, { error: "unauthorized", reason: auth.reason ?? "agent_mismatch" });
      return false;
    }
    const nonce = auth.nonce!;
    const now = Date.now();
    if (seenNonces.has(nonce)) {
      metrics.rejected_auth++;
      send(res, 401, { error: "unauthorized", reason: "nonce_replay" });
      return false;
    }
    seenNonces.set(nonce, now + 5 * 60 * 1000);
    return true;
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    metrics.requests++;
    const method = (req.method || "GET").toUpperCase();
    const url = new URL(req.url || "/", "http://localhost");
    const path = stripBasePath(url.pathname, cfg.basePath);
    const now = Date.now();

    if (method === "OPTIONS" && (path === "/health" || path === "/public-stats")) {
      res.writeHead(204, publicStatusHeaders);
      res.end();
      return;
    }

    // Internal implementation note.
    if (method === "GET" && path === "/health") {
      sendPublicStatus(res, 200, { ok: true, service: "shellmates-relay", version: SERVER_VERSION, open: cfg.open });
      return;
    }

    if (method === "GET" && path === "/public-stats") {
      sendPublicStatus(res, 200, store.publicStats(cfg.activeConversationTtlMs, new Date(now)));
      return;
    }

    // Internal implementation note.
    if (!cfg.open && cfg.accessToken) {
      const token = req.headers["x-tl-access"]?.toString();
      if (token !== cfg.accessToken) {
        metrics.rejected_admission++;
        send(res, 401, { error: "admission_denied", hint: "X-TL-Access required" });
        return;
      }
    }

    // rate limit(IP)
    const ip = clientIp(req);
    const countryCode = countryFromRequest(req, ip);
    if (!rate.check(`ip:${ip}`, cfg.rateMax, now)) {
      metrics.rejected_rate++;
      send(res, 429, { error: "rate_limited" });
      return;
    }

    try {
      // ── /metrics ──
      if (method === "GET" && path === "/metrics") {
        send(res, 200, { ...metrics, stats: store.stats(), public_stats: store.publicStats(cfg.activeConversationTtlMs, new Date(now)) });
        return;
      }

      // ── /directory ──
      if (path === "/directory" && method === "GET") {
        const limit = Number(url.searchParams.get("limit") || "500");
        const { cards, nextCursor } = store.listCards({
          limit: Number.isFinite(limit) ? limit : 500,
          mode: url.searchParams.get("mode") || undefined,
          country: url.searchParams.get("country") || undefined,
          cursor: url.searchParams.get("cursor") || undefined,
        });
        send(res, 200, { cards, next_cursor: nextCursor });
        return;
      }

      const dirMatch = path.match(/^\/directory\/(agent_[0-9a-f]{16})$/);
      if (dirMatch) {
        const agentId = dirMatch[1]!;
        if (method === "GET") {
          const card = store.getCard(agentId);
          if (!card) {
            send(res, 404, { error: "not_found" });
            return;
          }
          send(res, 200, { card });
          return;
        }
        if (method === "PUT") {
          const body = await readBody(req, cfg.maxCardBytes);
          if (body === null) {
            metrics.rejected_validation++;
            send(res, 413, { error: "card_too_large" });
            return;
          }
          let card: ProfileCard;
          try {
            card = JSON.parse(body) as ProfileCard;
          } catch {
            metrics.rejected_validation++;
            send(res, 400, { error: "bad_json" });
            return;
          }
          if (card.owner !== agentId) {
            metrics.rejected_validation++;
            send(res, 400, { error: "owner_path_mismatch" });
            return;
          }
          // Internal implementation note.
          const v = verifyCard(card);
          if (!v.ok) {
            metrics.rejected_validation++;
            send(res, 400, { error: "invalid_card", reason: v.reason });
            return;
          }
          if (cfg.allowlist && !cfg.allowlist.has(agentId)) {
            metrics.rejected_admission++;
            send(res, 403, { error: "not_allowlisted" });
            return;
          }
          store.putCard(card);
          store.observeAgent(agentId, countryCode, new Date(now));
          metrics.cards_published++;
          send(res, 200, { ok: true });
          return;
        }
        if (method === "DELETE") {
          if (!requireOwner(req, res, "DELETE", path, agentId)) return;
          store.observeAgent(agentId, countryCode, new Date(now));
          store.deleteCard(agentId);
          send(res, 200, { ok: true });
          return;
        }
      }

      // ── /relay ──
      const relayInbox = path.match(/^\/relay\/(agent_[0-9a-f]{16})$/);
      if (relayInbox) {
        const agentId = relayInbox[1]!;
        if (method === "POST") {
          if (!rate.check(`relaypost:${ip}`, cfg.rateRelayPostMax, now)) {
            metrics.rejected_rate++;
            send(res, 429, { error: "rate_limited" });
            return;
          }
          const body = await readBody(req, cfg.maxEnvelopeBytes);
          if (body === null) {
            metrics.rejected_validation++;
            send(res, 413, { error: "envelope_too_large" });
            return;
          }
          let env: Envelope;
          try {
            env = JSON.parse(body) as Envelope;
          } catch {
            metrics.rejected_validation++;
            send(res, 400, { error: "bad_json" });
            return;
          }
          // Internal implementation note.
          if (env.to !== agentId || !isAgentId(env.from) || !isPrefixedId(env.id, "env") || !env.type) {
            metrics.rejected_validation++;
            send(res, 400, { error: "invalid_envelope" });
            return;
          }
          if (cfg.allowlist && !cfg.allowlist.has(env.from)) {
            metrics.rejected_admission++;
            send(res, 403, { error: "sender_not_allowlisted" });
            return;
          }
          const stored = store.putEnvelope(env);
          if (!stored) {
            send(res, 429, { error: "inbox_full" });
            return;
          }
          store.observeEnvelope(env, countryCode, new Date(now));
          metrics.envelopes_in++;
          send(res, 200, { ok: true, id: env.id });
          return;
        }
        if (method === "GET") {
          if (!requireOwner(req, res, "GET", path, agentId)) return;
          store.observeAgent(agentId, countryCode, new Date(now));
          send(res, 200, { envelopes: store.listEnvelopes(agentId) });
          return;
        }
      }

      const relayDel = path.match(/^\/relay\/(agent_[0-9a-f]{16})\/(env_[0-9a-f]{8,64})$/);
      if (relayDel && method === "DELETE") {
        const agentId = relayDel[1]!;
        const envId = relayDel[2]!;
        if (!requireOwner(req, res, "DELETE", path, agentId)) return;
        store.observeAgent(agentId, countryCode, new Date(now));
        store.deleteEnvelope(agentId, envId);
        metrics.envelopes_acked++;
        send(res, 200, { ok: true });
        return;
      }

      send(res, 404, { error: "not_found" });
    } catch (e) {
      // Internal implementation note.
      process.stderr.write(`[tl-relay] 500 ${method} ${path}: ${(e as Error).message}\n`);
      send(res, 500, { error: "internal" });
    }
  };

  const server = createServer((req, res) => {
    handler(req, res).catch((e) => {
      process.stderr.write(`[tl-relay] 500 (uncaught): ${(e as Error).message}\n`);
      try {
        send(res, 500, { error: "internal" });
      } catch {
        /* noop */
      }
    });
  });

  // Internal implementation note.
  const t1 = setInterval(() => {
    const now = Date.now();
    for (const [n, exp] of seenNonces) if (exp <= now) seenNonces.delete(n);
    rate.gc(now);
  }, 60 * 1000);
  const t2 = setInterval(() => store.gc(), 60 * 60 * 1000);
  t1.unref?.();
  t2.unref?.();

  return { server, store, metrics, timers: [t1, t2] };
}

/** Internal implementation note. */
export function startServer(cfg: ServerConfig = resolveServerConfig()): Promise<RunningServer> {
  const { server, store, timers } = createApp(cfg);
  return new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(cfg.port, cfg.host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : cfg.port;
      res({
        server,
        port,
        store,
        close: () =>
          new Promise<void>((done) => {
            for (const t of timers) clearInterval(t);
            server.close(() => done());
          }),
      });
    });
  });
}

export async function runRelayServer(): Promise<void> {
  const cfg = resolveServerConfig();
  const running = await startServer(cfg);
  const admission = cfg.open ? "OPEN (admission disabled)" : cfg.accessToken ? "TOKEN (X-TL-Access required)" : "WARN NO TOKEN (recommended: set TL_RELAY_ACCESS_TOKEN or TL_RELAY_OPEN=true)";
  // Internal implementation note.
  console.log(`TL_RELAY_LISTENING ${running.port}`);
  process.stderr.write(
    `Shellmates relay/directory v${SERVER_VERSION} → http://${cfg.host}:${running.port}\n` +
      `  data: ${cfg.dataRoot}\n  admission: ${admission}\n  allowlist: ${cfg.allowlist ? cfg.allowlist.size + " agents" : "off"}\n`,
  );
  const shutdown = (): void => {
    running.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isMain = isMainEntry(import.meta.url);
if (isMain) {
  runRelayServer().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
