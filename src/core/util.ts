// 공용 유틸: base64url, 결정적(canonical) JSON, ID 생성, 시간 헬퍼.
import { randomBytes } from "node:crypto";

/** Buffer/문자열 → base64url 문자열 */
export function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

/** base64url 문자열 → Buffer */
export function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

/**
 * 서명 대상이 되는 결정적 JSON 직렬화.
 * 객체 키를 재귀적으로 정렬해 동일 내용이면 항상 동일 문자열이 되도록 한다.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue; // undefined 키는 직렬화에서 제외
      out[key] = sortDeep(v);
    }
    return out;
  }
  return value;
}

/** prefix_<랜덤 hex> 형식의 ID 생성 */
export function newId(prefix: string, bytes = 8): string {
  return `${prefix}_${randomBytes(bytes).toString("hex")}`;
}

/** 랜덤 nonce (base64url) — replay 방지용 */
export function newNonce(bytes = 16): string {
  return b64url(randomBytes(bytes));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDaysIso(days: number, from: Date = new Date()): string {
  const d = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

export function isExpired(expiresAtIso: string, now: Date = new Date()): boolean {
  const t = Date.parse(expiresAtIso);
  if (Number.isNaN(t)) return true;
  return t <= now.getTime();
}

/** 문자열만 추려 정규화(비문자열 원소 방어 — 악성/손상 입력에도 throw 안 함) */
function normStrings(a: unknown): string[] {
  if (!Array.isArray(a)) return [];
  return a.filter((x): x is string => typeof x === "string");
}

/** 두 배열의 Jaccard 유사도(대소문자 무시, 0..1) */
export function jaccard(a: string[], b: string[]): number {
  const sa = new Set(normStrings(a).map((x) => x.toLowerCase().trim()).filter(Boolean));
  const sb = new Set(normStrings(b).map((x) => x.toLowerCase().trim()).filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** agent_id 형식 검증 (경로 traversal 방지: 파일 경로에 쓰기 전 항상 검증) */
export function isAgentId(s: unknown): s is string {
  return typeof s === "string" && /^agent_[0-9a-f]{16}$/.test(s);
}

/** prefix_<hex> 형식 ID 검증(envelope/chat/intro/msg) */
export function isPrefixedId(s: unknown, prefix: string): s is string {
  return typeof s === "string" && new RegExp(`^${prefix}_[0-9a-f]{8,64}$`).test(s);
}

/** 두 배열의 교집합(원본 a의 표기 유지) */
export function intersect(a: string[], b: string[]): string[] {
  const sb = new Set(normStrings(b).map((x) => x.toLowerCase().trim()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of normStrings(a)) {
    const k = x.toLowerCase().trim();
    if (sb.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}
