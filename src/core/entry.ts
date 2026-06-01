// 엔트리포인트 판정 — bin 심볼릭 링크(npm link로 생긴 `tl`/`tl-daemon` 등)로 실행될 때도
// "이 모듈이 직접 실행된 엔트리인가"를 안전하게 판단한다.
// process.argv[1]은 심링크 경로, import.meta.url은 (Node가 심링크를 해소한) 실제 파일 경로라
// 단순 비교는 어긋난다 → 양쪽을 realpath로 정규화해 비교한다.
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
