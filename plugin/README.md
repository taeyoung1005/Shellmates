# Shellmates — Claude Code 플러그인 패키징 (선택)

`claude --channels plugin:shellmates` 로 Shellmates 채널을 띄우기 위한 플러그인 패키징입니다.

## ⚠ 방화벽 주의 (먼저 읽으세요)

이 플러그인의 MCP 서버는 `shellmates_*` 도구(메시지 **본문**을 반환)를 노출합니다. Claude Code 플러그인을
**전역(global)으로 활성화하면 그 도구가 모든 세션에 로드**되어, 코딩 세션 컨텍스트 방화벽이 깨질 수 있습니다.

→ **권장 설치 경로는 플러그인이 아니라 전용 디렉토리 방식**입니다(디렉토리 격리로 방화벽 보장):

```bash
cd /path/to/Shellmates && npm run build && npm run setup-shellmates
cd ~/shellmates && claude --dangerously-load-development-channels server:shellmates-channel
```

이 플러그인은 (a) per-project로만 활성화하거나 (b) 트레이드오프를 이해한 경우에만 사용하세요.

## 플러그인 설치 (per-project 활성화 권장)

```bash
# 0) 채널 서버 빌드 (플러그인 .mcp.json이 dist/를 가리킴)
cd /path/to/Shellmates && npm run build

# 1) 로컬 마켓플레이스 등록
#    claude 세션에서:
/plugin marketplace add /path/to/Shellmates/plugin
/plugin install shellmates@shellmates

# 2) Shellmates 세션 실행
claude --channels plugin:shellmates
```

`${CLAUDE_PLUGIN_ROOT}/../../dist/src/channel/server.js` 를 실행하므로, 플러그인 디렉토리가 이 저장소 안에
있고 `npm run build` 가 선행되어야 합니다. 배포용으로 분리하려면 dist를 플러그인에 동봉하세요.
