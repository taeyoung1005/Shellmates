// 서버 파일 백엔드 — zero-dep. relay 봉투 큐 + directory 카드 저장.
//  - serverData/directory/<agentId>.json   (서명 카드, 클라가 최종 재검증)
//  - serverData/relay/<agentId>/<envId>.json (암호 봉투; 서버는 메타데이터만, 본문 복호화 X)
// 경로 안전: 모든 agentId/envId는 isAgentId/isPrefixedId로 검증 후 경로 조립(traversal 차단).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { Envelope, ProfileCard } from "../core/types.js";
import { isAgentId, isPrefixedId } from "../core/util.js";

export interface ServerStoreConfig {
  root: string;
  envelopeTtlMs: number; // 봉투 만료(기본 7일)
  inboxMax: number; // inbox 큐 최대 길이(기본 1000)
}

function atomicWrite(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path); // rename은 원자적(동일 파일시스템)
}

export class ServerStore {
  readonly directoryDir: string;
  readonly relayDir: string;

  constructor(private readonly cfg: ServerStoreConfig) {
    this.directoryDir = join(cfg.root, "directory");
    this.relayDir = join(cfg.root, "relay");
    mkdirSync(this.directoryDir, { recursive: true });
    mkdirSync(this.relayDir, { recursive: true });
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
   * 카드 목록(coarse 필터 + limit + cursor 페이지네이션). 만료 카드는 제외. 매칭 점수는 클라가 로컬 계산.
   * cursor는 정렬된 파일 목록에 대한 offset(문자열). nextCursor가 null이면 끝.
   * 페이지는 "스캔한 파일 수" 기준(필터로 적게 반환될 수 있음) → 클라가 nextCursor까지 루프하면 전체를 본다.
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
        if (card.expires_at && Date.parse(card.expires_at) <= now.getTime()) continue; // 만료 제외
        if (opts.mode && !(card.matching_modes ?? []).includes(opts.mode as never)) continue;
        if (opts.country && card.country?.toLowerCase() !== opts.country.toLowerCase()) continue;
        out.push(card);
      } catch {
        /* 손상 카드 무시 */
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
   * 봉투를 수신자 inbox에 큐잉. inbox가 가득 차면 false(서버가 429 응답).
   * 같은 id 재전송은 멱등(덮어씀) → 클라 dedupe와 결합해 중복 안전.
   */
  putEnvelope(env: Envelope): boolean {
    const dir = this.inboxDir(env.to);
    mkdirSync(dir, { recursive: true });
    const path = this.envPath(env.to, env.id);
    const exists = existsSync(path);
    if (!exists && this.inboxCount(env.to) >= this.cfg.inboxMax) return false; // 가득 참(기존 봉투 보호)
    atomicWrite(path, JSON.stringify(env));
    return true;
  }

  private inboxCount(agentId: string): number {
    const dir = this.inboxDir(agentId);
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((f) => f.endsWith(".json")).length;
  }

  /** 내 inbox 봉투 목록. 만료(TTL) 봉투는 제외하고 반환(GET은 삭제 안 함 — ACK 모델). */
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
          rmSync(p); // 만료 GC
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
    out.sort((a, b) => a.mtime - b.mtime); // 도착 순서
    return out.map((x) => x.env);
  }

  /** 봉투 ack 삭제(소유자 인증 후 서버가 호출). */
  deleteEnvelope(agentId: string, envId: string): void {
    if (!isAgentId(agentId) || !isPrefixedId(envId, "env")) return;
    const p = this.envPath(agentId, envId);
    if (existsSync(p)) rmSync(p);
  }

  // ── GC / 메트릭 ──────────────────────────────────────────────────────
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
