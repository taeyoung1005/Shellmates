// Helper for detecting whether this module was launched directly as the
// process entry point (the ESM equivalent of `require.main === module`),
// used by CLI/server bundles to decide whether to auto-run on import.
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
