// Detects prompt-injection / contact-exfiltration patterns and neutralizes hidden characters
// in untrusted inbound peer text before it is surfaced to the model or displayed.
import { STRIP_INVISIBLE, stripInvisibleForDisplay } from "./util.js";

const INCOMING_TEXT_MAX_CHARS = 8000;

const INJECTION_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "ignore-previous", re: /ignore\s+(all\s+|the\s+)?previous/i },
  { label: "disregard-above", re: /disregard\s+(all\s+|the\s+)?(previous|above|prior)/i },
  { label: "system-prompt", re: /system\s*prompt/i },
  { label: "developer-message", re: /developer\s*(message|prompt|instruction)/i },
  { label: "reveal-instructions", re: /reveal\s+(your|the)\s+(system|instructions?|prompt|rules)/i },
  { label: "you-are-now", re: /you\s+are\s+now\b/i },
  { label: "new-instructions", re: /new\s+instructions?:/i },
  { label: "api-key", re: /api[_\s-]?key/i },
  { label: "private-key", re: /\bprivate\s*key\b/i },
  { label: "env-var", re: /environment\s+variable|process\.env|\.env\b/i },
  { label: "exec-command", re: /\b(run|execute)\s+(the\s+)?(command|shell|code|script)\b/i },
  { label: "role-tag", re: /<\/?(system|assistant|developer|tool)>/i },
  { label: "inst-tag", re: /\[\/?INST\]|<\|[^|]*\|>/i },
  { label: "exfil", re: /\b(print|show|send|leak|dump)\b.*\b(secret|token|key|credential|password)s?\b/i },
];

const CONTACT_PATTERNS: { type: string; re: RegExp }[] = [
  { type: "email", re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { type: "phone", re: /(?:\+?\d[\d\-\s().]{7,}\d)/ },
  { type: "url", re: /\bhttps?:\/\/[^\s]+/i },
];

export interface SanitizeResult {
  text: string;
  flagged: boolean;
  flags: string[];
}

export function detectInjection(text: string): string[] {
  // Strip hidden characters first so patterns can't be split by zero-width/bidi insertions.
  const probe = String(text).replace(STRIP_INVISIBLE, "");
  const found: string[] = [];
  for (const { label, re } of INJECTION_PATTERNS) {
    if (re.test(probe)) found.push(label);
  }
  return found;
}

export interface ContactHit {
  type: string;
  value: string;
}

export function detectContact(text: string): ContactHit[] {
  const hits: ContactHit[] = [];
  for (const { type, re } of CONTACT_PATTERNS) {
    const m = text.match(re);
    if (m && m[0]) hits.push({ type, value: m[0] });
  }
  return hits;
}

/**
 * Sanitizes untrusted inbound peer text before it reaches the model or UI:
 * strips invisible characters, truncates to INCOMING_TEXT_MAX_CHARS, and flags
 * any prompt-injection or contact-exfiltration patterns it contains.
 */
export function sanitizeIncoming(text: string): SanitizeResult {
  // Strip hidden characters from the RETURNED text too (not just the detection probe) so the
  // body shown to the model/UI carries no zero-width or bidi-override residue (sec-03), while
  // keeping ZWNJ/ZWJ so legitimate emoji sequences are not mangled.
  const cleaned = stripInvisibleForDisplay(text).slice(0, INCOMING_TEXT_MAX_CHARS);
  const inj = detectInjection(cleaned).map((l) => `injection:${l}`);
  const contact = detectContact(cleaned).map((c) => `contact:${c.type}`);
  const flags = [...inj, ...contact];
  return { text: cleaned, flagged: flags.length > 0, flags };
}
