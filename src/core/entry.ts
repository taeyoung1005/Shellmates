// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMainEntry(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}
