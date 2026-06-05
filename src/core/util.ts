// Shared pure helpers: text sanitization, base64url, canonical JSON, id/nonce generation,
// time/expiry checks, and tag-set similarity used across identity, envelope, and matching code.
import { randomBytes } from "node:crypto";

// Invisible / zero-width / bidirectional-control characters stripped from untrusted peer text
// before it is displayed or pattern-matched. Covers C0 (minus TAB/LF/CR so line structure
// survives), DEL + C1, the zero-width/bidi block, line/paragraph separators, the word joiner,
// and the BOM. Callers that need a single line additionally collapse remaining newlines.
export const STRIP_INVISIBLE = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028\\u2029\\u2060\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]",
  "g",
);

/**
 * Strip invisible/bidi characters for DISPLAY, but keep ZWNJ/ZWJ (U+200C/U+200D) so legitimate
 * emoji sequences (e.g. 👨‍💻) and joined scripts survive. Detection paths use the stricter
 * STRIP_INVISIBLE (which removes the joiners too) so they can't be split by them.
 */
export function stripInvisibleForDisplay(s: string): string {
  return String(s).replace(STRIP_INVISIBLE, (ch) => {
    const c = ch.charCodeAt(0);
    return c === 0x200c || c === 0x200d ? ch : ""; // keep ZWNJ / ZWJ
  });
}

/** Encode bytes as URL-safe base64 (no padding) for use in ids, nonces, and envelopes. */
export function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

/** Decode a URL-safe base64 string back into a Buffer. */
export function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

/**
 * Produce a canonical JSON string with object keys sorted recursively and undefined values
 * dropped, so the same logical value always serializes identically for signing and verification.
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

/** Generate a prefixed random id of the form `<prefix>_<hex>` (default 8 random bytes). */
export function newId(prefix: string, bytes = 8): string {
  return `${prefix}_${randomBytes(bytes).toString("hex")}`;
}

/** Generate a fresh base64url anti-replay nonce from random bytes (default 16). */
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

/** Coerce an unknown value to an array containing only its string elements (non-arrays → []). */
function normStrings(a: unknown): string[] {
  if (!Array.isArray(a)) return [];
  return a.filter((x): x is string => typeof x === "string");
}

/**
 * Jaccard similarity (intersection over union) of two tag lists, after lowercasing, trimming,
 * and de-duplicating. Two empty sets score 0; used to rank profile/interest overlap.
 */
export function jaccard(a: string[], b: string[]): number {
  const sa = new Set(normStrings(a).map((x) => x.toLowerCase().trim()).filter(Boolean));
  const sb = new Set(normStrings(b).map((x) => x.toLowerCase().trim()).filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Type guard for an agent_id: the literal "agent_" prefix followed by exactly 16 hex chars. */
export function isAgentId(s: unknown): s is string {
  return typeof s === "string" && /^agent_[0-9a-f]{16}$/.test(s);
}

/** Type guard for a `<prefix>_<hex>` id with an 8-to-64-char hex suffix. */
export function isPrefixedId(s: unknown, prefix: string): s is string {
  return typeof s === "string" && new RegExp(`^${prefix}_[0-9a-f]{8,64}$`).test(s);
}

/**
 * Return the elements of `a` whose lowercased/trimmed form also appears in `b`, de-duplicated
 * and preserving `a`'s original casing and order.
 */
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
