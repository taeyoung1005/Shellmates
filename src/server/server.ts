#!/usr/bin/env node
// Shellmates relay/directory 레퍼런스 서버 — Node 내장 http, zero-dep.
//
// 보안 2계층(PLAN §3.4):
//  - Layer 1 admission(누가 접속 가능한가): X-TL-Access 공유 토큰 + (선택) agent_id allowlist.
//    TL_RELAY_OPEN=true 면 해제(오픈소스 공개 시). 내부 테스트 기간엔 토큰으로 잠금.
//  - Layer 2 identity/integrity/privacy(항상 ON): TL-Sig 서명 인증(소유자만 inbox 읽기/삭제),
//    카드 서명 검증, 봉투 형식/크기/to일치/rate 검증. 본문(ciphertext)은 절대 복호화/열람하지 않음.
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
  dataRoot: string;
  open: boolean; // admission 해제
  accessToken: string | null; // X-TL-Access
  allowlist: Set<string> | null; // 허용 agent_id (null = 제한 없음)
  maxEnvelopeBytes: number;
  maxCardBytes: number;
  inboxMax: number;
  envelopeTtlMs: number;
  rateMax: number; // 윈도당 전체 요청 한도(IP)
  rateRelayPostMax: number; // 윈도당 POST /relay 한도(IP) — intro/메시지 스팸 방어
  rateWindowMs: number;
  trustProxy: boolean; // X-Forwarded-For 신뢰 여부(리버스 프록시 뒤일 때만 true)
}

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function resolveServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  let allowlist: Set<string> | null = null;
  const allowPath = env.TL_RELAY_ALLOWLIST;
  if (allowPath && existsSync(allowPath)) {
    try {
      const arr = JSON.parse(readFileSync(allowPath, "utf8")) as string[];
      allowlist = new Set(arr.filter((x) => isAgentId(x)));
    } catch {
      allowlist = new Set(); // 파싱 실패 시 안전하게 전부 차단
    }
  }
  return {
    host: env.TL_RELAY_HOST || "127.0.0.1",
    port: envInt("TL_RELAY_PORT", envInt("PORT", 8787)),
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
  };
}

// ── 단순 고정 윈도 rate limiter ─────────────────────────────────────────
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
  const seenNonces = new Map<string, number>(); // nonce → 만료 ms
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

  // rate limit 키. 기본은 소켓 IP(스푸핑 불가). TL_TRUST_PROXY=true(리버스 프록시 뒤)일 때만
  // X-Forwarded-For의 **rightmost**(우리 프록시가 추가한 신뢰 가능한 hop)를 사용한다.
  // leftmost는 클라이언트가 임의로 넣을 수 있어 신뢰하면 rate limit이 무력화된다.
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

  // 본문을 읽되 maxBytes 초과 시 null 반환(413). 초과해도 소켓을 즉시 destroy하지 않고
  // 남은 데이터를 drain한 뒤 'end'에서 응답한다 → 클라가 413 응답을 정상 수신(RST 방지).
  // 단 hardCap(=maxBytes*4) 초과는 진짜 어뷰즈로 보고 연결을 끊는다.
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
          chunks.length = 0; // 메모리 확보(본문 폐기)
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

  // 서명 인증 + 소유자 일치 + nonce replay 검사. 통과 시 true, 실패 시 응답 전송 후 false.
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
    const path = url.pathname;
    const now = Date.now();

    // /health 는 admission/rate 제외(헬스체크/로드밸런서용)
    if (method === "GET" && path === "/health") {
      send(res, 200, { ok: true, service: "shellmates-relay", version: SERVER_VERSION, open: cfg.open });
      return;
    }

    // Layer 1: admission(공유 토큰)
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
    if (!rate.check(`ip:${ip}`, cfg.rateMax, now)) {
      metrics.rejected_rate++;
      send(res, 429, { error: "rate_limited" });
      return;
    }

    try {
      // ── /metrics ──
      if (method === "GET" && path === "/metrics") {
        send(res, 200, { ...metrics, stats: store.stats() });
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
          // 서버도 카드 서명/바인딩/만료 검증(verifyCard는 순수 crypto — 본문 열람 아님)
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
          metrics.cards_published++;
          send(res, 200, { ok: true });
          return;
        }
        if (method === "DELETE") {
          if (!requireOwner(req, res, "DELETE", path, agentId)) return;
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
          // 형식/to일치 검증(서명 검증은 클라가 최종 수행 — 서버는 본문/신원 보증 X)
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
          metrics.envelopes_in++;
          send(res, 200, { ok: true, id: env.id });
          return;
        }
        if (method === "GET") {
          if (!requireOwner(req, res, "GET", path, agentId)) return;
          send(res, 200, { envelopes: store.listEnvelopes(agentId) });
          return;
        }
      }

      const relayDel = path.match(/^\/relay\/(agent_[0-9a-f]{16})\/(env_[0-9a-f]{8,64})$/);
      if (relayDel && method === "DELETE") {
        const agentId = relayDel[1]!;
        const envId = relayDel[2]!;
        if (!requireOwner(req, res, "DELETE", path, agentId)) return;
        store.deleteEnvelope(agentId, envId);
        metrics.envelopes_acked++;
        send(res, 200, { ok: true });
        return;
      }

      send(res, 404, { error: "not_found" });
    } catch (e) {
      // 클라에는 일반 메시지만(절대경로/내부 레이아웃 누출 방지). 상세는 서버 로그로.
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

  // 주기 GC: nonce 캐시 + rate + 봉투/카드 TTL
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

/** 서버 시작(프로그램적 사용/테스트). port=0 이면 OS가 빈 포트 할당. */
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

async function main(): Promise<void> {
  const cfg = resolveServerConfig();
  const running = await startServer(cfg);
  const admission = cfg.open ? "OPEN (admission 해제)" : cfg.accessToken ? "TOKEN (X-TL-Access 필요)" : "⚠ NO TOKEN (권장: TL_RELAY_ACCESS_TOKEN 설정 또는 TL_RELAY_OPEN=true)";
  // 테스트 하네스가 stdout에서 포트를 읽음
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
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
