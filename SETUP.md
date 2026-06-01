# TerminalLove — 설치 & 테스트 가이드

TerminalLove는 **두 사람(에이전트)** 사이의 소개팅이라, 테스트하려면 보통 **신원 2개**가 필요합니다.
한 컴퓨터에서 `TL_HOME`(내 데이터)만 다르게 하고 `TL_NET`(공유 네트워크: 디렉토리+relay)을 같게 두면 두 사람을 시뮬레이션할 수 있습니다.

절대경로(이 저장소): `/Users/taeyoungpark/Desktop/TerminalLove`
MCP 서버 절대경로: `/Users/taeyoungpark/Desktop/TerminalLove/dist/src/mcp/server.js`

> **검증 상태(실측)**: MCP 서버가 공식 MCP SDK stdio 클라이언트로 정상 응답함을 확인했고, 등록 명령도 실제로 실행해 검증함 —
> Claude Code `2.1.159`: `claude mcp add` 후 `claude mcp list`에서 **`✓ Connected`**, `get`/`remove` 정상.
> Codex `0.135.0`: `codex mcp add`/`list`(enabled)/`get`(stdio 정확)/`remove` 정상.
> 단, 로그인이 필요한 인터랙티브 단계(세션 안 `/mcp` 패널·툴 직접 호출)는 사용자 환경에서 확인 필요.

---

## 0. 사전 준비 (공통, 1회)

```bash
cd /Users/taeyoungpark/Desktop/TerminalLove
npm install
npm run build           # dist/ 생성 (Claude Code/Codex가 실행할 산출물)

# (선택) 전역 명령 tl / tl-daemon / tl-mcp 사용하려면:
npm link                # 이후 어디서든 `tl`, `tl-daemon`, `tl-mcp` 사용 가능
# npm link이 권한 때문에 안 되면 아래처럼 절대경로로 대체 가능:
#   node /Users/taeyoungpark/Desktop/TerminalLove/dist/src/cli/cli.js <명령>
```

---

## 1. 가장 빠른 검증 (CLI/도구 설치 없이)

```bash
npm run demo     # 한 프로세스에서 Alice/Bob 전체 플로우 + 보안 시나리오 시연
npm test         # 37개 단위/통합/MCP 테스트
```

`✅ 데모 완료 — 모든 단언 통과` 가 나오면 코어가 정상입니다.

---

## 2. 두 사람처럼 직접 조작 (별도 세션 = 실제 사용 방식)

터미널 2개를 엽니다. (전역 `tl` 안 했으면 `tl` 대신 `npm run cli --` 사용)

**터미널 A — Alice**
```bash
export TL_HOME=$HOME/.tl/alice
export TL_NET=$HOME/.tl/net
tl init
tl profile --name Alice --country Korea --langs "Korean,English" \
   --stacks "TypeScript,Rust,AI Agents" --interests "Startups,AI Products,Side Projects" \
   --style "direct, logical" --modes "dating,builder" --hours night
tl publish
tl scan                      # Bob이 publish하면 후보로 보임
```

**터미널 B — Bob**
```bash
export TL_HOME=$HOME/.tl/bob
export TL_NET=$HOME/.tl/net          # ★ Alice와 같은 TL_NET
tl init
tl profile --name Bob --country Spain --langs "English,Spanish" \
   --stacks "TypeScript,React,AI Tools" --interests "AI Products,Design,Side Projects" \
   --style "warm, curious" --modes "dating,builder" --hours night
tl publish
tl whoami                    # 내 agent_id 확인 (Alice가 scan으로도 볼 수 있음)
```

**다시 터미널 A — Alice가 intro**
```bash
tl scan                      # Bob의 agent_id 확인
tl intro <BOB_AGENT_ID> "안녕하세요 Bob! 같이 AI 얘기해요"
```

**터미널 B — Bob가 수락 & 대화**
```bash
tl-daemon --once             # 🔔 알림(카운트만, 본문 없음) — 컨텍스트 방화벽 확인
tl inbox                     # intro_id 확인
tl accept <INTRO_ID>
tl open                      # Alice 메시지 + 코치 제안 표시
tl send "반가워요! 저는 React/AI 툴 만들고 있어요"
```

**터미널 A — Alice가 답장**
```bash
tl-daemon --once             # 새 메시지 알림(본문 없음)
tl open                      # Bob 메시지 + 코치 제안 (본문은 여기서만 보임)
tl reply                     # 코치 추천 답장 보기
tl send "오 디자인 시스템 얘기 더 듣고 싶어요"
```

**종료/안전**
```bash
tl end           # 대화 종료(언매치) → 재추천 제외
tl end --block   # 종료 + 일방향 차단
tl block         # 현재 상대 차단
tl report <agent_id> 스팸
```

> 백그라운드 알림: 한쪽 터미널에서 `tl-daemon` (--once 없이) 를 켜두면 새 메시지마다 "🔔 N unread"만 떠요. 본문은 항상 `tl open`에서만 — **소개팅 내용이 작업 컨텍스트로 새지 않습니다.**

---

## 3. Claude Code에 연동

### 설치
```bash
# 택1
npm install -g @anthropic-ai/claude-code        # Node 18+ 필요
curl -fsSL https://claude.ai/install.sh | bash  # 네이티브 설치(자동 업데이트)
claude --version
```
(Claude Code는 Pro/Max/Team/Enterprise 등 유료 플랜 필요)

### TerminalLove MCP 등록 (thin·컨텍스트-세이프)
```bash
claude mcp add --scope user terminallove -- node /Users/taeyoungpark/Desktop/TerminalLove/dist/src/mcp/server.js
# (선택) 데이터 경로 고정:
# claude mcp add --scope user --env TL_HOME=$HOME/.tl/alice --env TL_NET=$HOME/.tl/net \
#   terminallove -- node /Users/taeyoungpark/Desktop/TerminalLove/dist/src/mcp/server.js
```
- 옵션(`--scope`,`--env`)은 **이름 앞**, 실행 명령은 **`--` 뒤**.
- 절대경로 권장(작업 디렉토리 의존 X).

### 확인 & 사용
```bash
claude            # 프로젝트 디렉토리에서 실행
```
세션 안에서:
```
/mcp
```
→ `terminallove` 서버와 도구 2개(`terminallove_status`, `terminallove_open_session`)가 보이면 성공.
Claude에게 "terminallove_status 호출해줘" 라고 하면 **카운트/이벤트만**(본문 없음) 반환합니다.
실제 대화는 §2의 별도 `tl` 세션에서 합니다. (이게 컨텍스트 방화벽의 핵심 사용 패턴)

관리:
```bash
claude mcp list
claude mcp get terminallove
claude mcp remove terminallove
```

---

## 4. Codex에 연동

### 설치
```bash
# 택1  (스코프 패키지 @openai/codex 주의)
npm install -g @openai/codex
brew install --cask codex
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex --version
codex login        # ChatGPT 계정 또는 API 키
```

### TerminalLove MCP 등록 (택1)
**(a) CLI 서브커맨드**
```bash
codex mcp add terminallove -- node /Users/taeyoungpark/Desktop/TerminalLove/dist/src/mcp/server.js
# 데이터 경로 고정: codex mcp add terminallove --env TL_HOME=$HOME/.tl/alice --env TL_NET=$HOME/.tl/net -- node /.../server.js
```
**(b) `~/.codex/config.toml` 직접 편집** (테이블명은 `mcp_servers`, 스네이크케이스!)
```toml
[mcp_servers.terminallove]
command = "node"
args = ["/Users/taeyoungpark/Desktop/TerminalLove/dist/src/mcp/server.js"]
startup_timeout_sec = 10

[mcp_servers.terminallove.env]
TL_HOME = "/Users/taeyoungpark/.tl/alice"
TL_NET  = "/Users/taeyoungpark/.tl/net"
```

### 확인 & 사용
```bash
codex
```
세션 안에서 `/mcp` → `terminallove`와 도구가 보이면 성공.
관리: `codex mcp list` / `codex mcp get terminallove` / `codex mcp remove terminallove`.

---

## 5. 트러블슈팅

- **`spawn node ENOENT` / 서버 안 뜸**: 등록 시 **절대경로** 사용. `npm run build` 했는지 확인(`dist/` 존재).
- **stdio MCP는 자동 재연결 안 됨**: 설정 바꾸면 세션 재시작.
- **Claude Code 옵션 위치**: `--scope`/`--env`는 이름 앞, 실행 명령은 `--` 뒤.
- **Codex 테이블명**: 반드시 `mcp_servers` (대시/공백 버전은 조용히 무시됨).
- **Codex `notify` 등 일부 키는 project-local `.codex/config.toml`에서 무시** → `~/.codex/config.toml`에 둘 것.
- **알림에 본문이 안 보이는 건 정상**: 설계상 본문/코칭은 `tl open`(별도 세션)에서만. MCP/데몬은 카운트만.
- **`--json` 출력에도 본문 없음(기본 레다크션)**. 별도 세션 TUI에서 원문이 필요하면 `tl open --json --include-bodies`.
