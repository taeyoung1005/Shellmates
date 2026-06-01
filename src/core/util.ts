// Internal implementation note.
import { randomBytes } from "node:crypto";

/** Internal implementation note. */
export function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

/** Internal implementation note. */
export function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

/**
 * Internal implementation note.
 * Internal implementation note.
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
      if (v === undefined) continue;
      out[key] = sortDeep(v);
    }
    return out;
  }
  return value;
}

/** Internal implementation note. */
export function newId(prefix: string, bytes = 8): string {
  return `${prefix}_${randomBytes(bytes).toString("hex")}`;
}

/** Internal implementation note. */
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

/** Internal implementation note. */
function normStrings(a: unknown): string[] {
  if (!Array.isArray(a)) return [];
  return a.filter((x): x is string => typeof x === "string");
}

/** Internal implementation note. */
export function jaccard(a: string[], b: string[]): number {
  const sa = new Set(normStrings(a).map((x) => x.toLowerCase().trim()).filter(Boolean));
  const sb = new Set(normStrings(b).map((x) => x.toLowerCase().trim()).filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Internal implementation note. */
export function isAgentId(s: unknown): s is string {
  return typeof s === "string" && /^agent_[0-9a-f]{16}$/.test(s);
}

/** Internal implementation note. */
export function isPrefixedId(s: unknown, prefix: string): s is string {
  return typeof s === "string" && new RegExp(`^${prefix}_[0-9a-f]{8,64}$`).test(s);
}

/** Internal implementation note. */
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
