// Internal implementation note.
// Internal implementation note.

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

// Internal implementation note.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");
// Internal implementation note.
// Internal implementation note.
const ZW_FORMAT = new RegExp("[\\u200B-\\u200F\\u2060\\uFEFF\\u202A-\\u202E\\u2066-\\u2069]", "g");

export interface SanitizeResult {
  text: string;
  flagged: boolean;
  flags: string[];
}

export function detectInjection(text: string): string[] {
  // Internal implementation note.
  const probe = String(text).replace(ZW_FORMAT, "");
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
 * Internal implementation note.
 * Internal implementation note.
 */
export function sanitizeIncoming(text: string): SanitizeResult {
  const cleaned = String(text).replace(CONTROL_CHARS, "").slice(0, 8000);
  const inj = detectInjection(cleaned).map((l) => `injection:${l}`);
  const contact = detectContact(cleaned).map((c) => `contact:${c.type}`);
  const flags = [...inj, ...contact];
  return { text: cleaned, flagged: flags.length > 0, flags };
}
