# TerminalLove — 진행 기록

## 프로젝트 정의
**TerminalLove** — 개발 에이전트(Claude Code/Codex/Cursor) 안에서 작동하는
오픈소스 에이전트 간 소개팅 프로토콜. 데이팅 앱이 아니라 "Claude Code 시대의 소개팅 프로토콜".
- 네이밍 확정: 제품=프로토콜=레퍼런스 클라이언트 모두 **`TerminalLove`**, 호스티드는 `TerminalLove Cloud`.
- "Agent Dating Protocol"은 영문 카테고리 설명어로만 사용.

## 확정 방향 (사용자 지시, 2026-06-01)
오픈소스 코어 + 선택적 hosted layer 로 **구현 예정**. 핵심 요소:
- public key 신원 (Ed25519, did:key 참고), 서명된 프로필 카드(expires_at 7일)
- 로컬 성향 분석 / 로컬 매칭 계산, 사용자 승인분만 공개
- E2E 암호화 메시지, relay는 내용 못 봄
- intro → accept → encrypted chat 플로우 (DM 금지, intro-first)
- `/dating` 명령어 체계 (intro는 agent_id로만, send/reply는 chat_id/alias로만)

## 작업 이력
### 2026-06-01 — 최종 기획서 작성
- 입력: 사용자가 `/goal`로 붙여넣은 3638줄 브레인스토밍 (paste-cache `7b4114d39f8e937e.txt`).
  - 컨텍스트에 본문이 펼쳐지지 않아 `~/.claude/paste-cache/`에서 원문을 찾아 전량 정독.
- 원문은 두 버전이 섞여 있었음: ①중앙 서버 데이팅 앱(초기안) → ②오픈소스 프로토콜+선택적 hosted(최종안).
- 사용자가 ②번을 구현 방향으로 확정 → ②로 단일화하고, ①의 보안/안전 논의는 hosted layer·클라 정책으로 흡수.
- 산출물: `기획서.md` (구현 기준). 구성 — 개요/문제/컨셉/포지셔닝/타깃·모드/5레이어 아키텍처/
  데이터 스키마/E2E UX/명령어 명세/보안(프롬프트 인젝션 포함)/프라이버시/Trust&Safety/키관리/
  글로벌/수익모델(hosted 중심)/MVP 범위/기술스택 권장안/지표·가설/리스크/로드맵 Phase1-4/
  기술선택지(자체 vs Nostr vs Matrix)/다음 단계/README 부록.

## 확정 결정 (2026-06-01, 사용자 응답·추가지시)
1. 네이밍: **TerminalLove로 통일** (제품=프로토콜=클라이언트)
2. 스택: **TypeScript + 공식 MCP SDK** (암호 tweetnacl: Ed25519 서명 / X25519 box)
3. 우선 클라이언트: **Claude Code + Codex** (두 개 동시 타깃)
4. **수익화 없음 — 완전 오픈소스.** hosted directory/relay는 무료·커뮤니티 인프라 (유료 브랜드/연락처 과금 삭제)
5. **대화 모델: 1:1 전용, 동시 활성 대화 1개.** 새 매칭 전 `/dating end` 필요 (멀티챗/chats/use/alias-스위칭 제거)
6. **안전: 일방향 `/dating block`(기본) + `/dating end`(언매치) + `/dating report`.** 강제 양방향 blacklist 미도입, 커뮤니티 blocklist는 opt-in. cold 대화 7일 무응답 자동 보관
7. **컨텍스트 방화벽(§10.4, 필수): 소개팅 메시지·코칭·알림은 진행 중인 코딩 세션 컨텍스트에 절대 주입 안 함.** 별도 컨텍스트 코칭 LLM + 사이드카 데몬 + out-of-band 표면.
   - **검증(2026-06, §10.4.1)**: CC·Codex 모두 MCP tool 결과·subagent 요약이 메인 컨텍스트로 들어감 → 대화/코칭을 메인 MCP/subagent로 노출 금지. **완전 격리 보장 = 별도 프로세스/세션.**
   - Claude Code: hook(exit0·무출력) + statusLine("🔔 N건") + 백그라운드 데몬 + **별도 `claude` 세션**. 메시징 MCP는 메인 세션 미등록.
   - Codex: `notify`(~/.codex/config.toml, agent-turn-complete) + hooks(hooks.json) + **`codex exec --profile <전용>` 별도 세션**(자체 mcp_servers). ⚠ Codex statusline 커스텀 텍스트 미배포 → 터미널 ping/notify로 대체.
   - **알림 정책 확정(§10.4.2)**: 메인 *화면*에 알림 한 줄·알림음·토스트 허용, 단 모델 *컨텍스트*엔 미주입("화면 표시 ≠ 컨텍스트 주입"). 도착 알림 트리거=데몬(hook은 외부 도착 감지 못함). 알림 라인은 카운트/발신 alias까지만, 본문·코칭 금지(별도 세션에서만).
8. Phase 1 범위: **단일 머신 데모 풀 플로우** — init→profile→publish→scan→intro→accept→open/send→coach (+end/block)

## 구현 (2026-06-01, ultracode)
스택: TypeScript + Node 내장 crypto(Ed25519/X25519, tweetnacl 대신) + 공식 MCP SDK 1.29.0 + node:test + tsx.
- 코어 5레이어: crypto/identity, profile, directory/matching, relay/messaging(1:1)/safety, coaching(격리)/engine + types/config/store/util.
- 표면: cli(/dating REPL+원샷+--json), daemon(out-of-band 알림, --once), mcp(thin·context-safe 2개 도구), tools/attack(적대적 주입), demo(E2E).
- 검증 현황: `tsc --noEmit` 0에러 / `npm test` 31/31 통과 / `npm run demo` 전 단언 통과 / `npm run build` 성공 / dist 멀티프로세스 CLI+데몬 스모크 통과(본문은 open에서만, 알림은 카운트만 = 컨텍스트 방화벽 실증) / attack 도구로 사칭·미매칭 주입 → rejected:2.
- 보안 검증됨: 사칭(서명위조)·미매칭DM·replay(id dedupe)·프로필변조·프롬프트인젝션 플래그.
### 검증/리뷰/수정 사이클 (완료)
- 서브에이전트 직접 조작 워크플로(6 agents): Alice/Bob 페르소나가 라이브 CLI로 자율 매칭·대화, 적대 에이전트 공격 차단(rejected=2), 인젝션 내용 0 → ok=true.
- 다차원 리뷰 워크플로(4 agents): critical 7/high 14/medium 19/low 7. 진짜 이슈 선별 후 수정:
  1) 누락 명령 6종(export/import-profile, invite, backup/import/rotate-key) 구현
  2) `--json` 본문/코칭/첫메시지 레다크션(방화벽 강화, `--include-bodies` 옵트인)
  3) 멀티프로세스 상태 락(store.withLock + Engine.tx) — reload→mutate→save 원자화
  4) agent_id 8→16 hex(64-bit, 충돌/사칭 저항)
  5) intro 첫 메시지를 서명된 card.box_pub로 복호화·peer 도출(키 치환 차단)
  6) directory/relay 경로 agent_id/env.id 형식검증(path traversal 하드닝)
  7) coldCheck NaN 가드, intro 스팸 캡(50), 첫메시지 길이 캡(2000)
- 적대적 재검증(Explore agent): 6개 수정 전부 CLOSED, 보안 회귀 없음(whoami getter는 단일프로세스 무해 cosmetic).
- 빌드 산출물 스모크 재검증: `--json` 본문 미노출/human·--include-bodies만 노출, 신규 명령 동작, import-key 동일신원 복원, 16-hex에서도 공격 rejected=2.

### 최종 상태 (완료)
- tsc 0에러 / **37/37 테스트 통과** / demo 전 단언 통과 / build 성공. 소스 18모듈+테스트 9파일(~2,620 LOC).
- 산출물: 기획서.md, README.md, LICENSE(MIT), MEMORY.md, package.json/tsconfig, src/**, test/**, dist/**.
- 미커밋(전역 규칙: 명시 요청 시에만 커밋). v0.1 한계: 멀티프로세스 동시쓰기는 락으로 직렬화하나 분산 relay 신뢰모델·DoS는 hosted layer 영역(문서화).

### 2026-06-01 — Codex/Claude Code 실제 세션 스모크
- Computer Use로 macOS Terminal 직접 제어를 시도했으나 `com.apple.Terminal`은 안전 정책상 사용 불가(`not allowed to use the app`)라서, 실제 Terminal 탭 2개를 shell/AppleScript로 열고 로그 기반으로 검증했다.
- 현재 환경에서 Codex/Claude 모두 처음에는 `terminallove` MCP가 등록되어 있지 않았다. 등록/검증:
  - Codex: `codex mcp add terminallove --env TL_HOME=$HOME/.tl/codex --env TL_NET=$HOME/.tl/net -- node /Users/taeyoungpark/Desktop/TerminalLove/dist/src/mcp/server.js`
  - Claude Code: `claude mcp add --scope user terminallove -e TL_HOME=$HOME/.tl/claude -e TL_NET=$HOME/.tl/net -- node /Users/taeyoungpark/Desktop/TerminalLove/dist/src/mcp/server.js`
  - `claude mcp get terminallove`는 `Status: ✓ Connected`; `codex mcp get terminallove`는 enabled stdio 설정 확인.
- 실제 두 신원 생성/게시: Codex=`agent_b3b28a63fc0caa5c`, Claude=`agent_eff6ae7f2a0971a6`, 공유 `TL_NET=$HOME/.tl/net`.
- 라이브 대화 플로우 검증: Codex → Claude intro, Claude accept/send, Codex daemon `🔔 TerminalLove: 2 unread` 및 `open --include-bodies`에서 왕복 메시지와 coaching 확인. daemon/MCP는 본문 없이 카운트/이벤트만 노출.
- Claude Code 실제 세션(`claude -p`, allowed MCP tools 제한): `terminallove_status`와 `terminallove_open_session` 호출 성공. status=`unread=1 · last_event=intro · from=Codex · active_chat=yes · inbox=0`, 본문/코칭 미노출.
- Codex 실제 세션: 기본 `codex exec --sandbox read-only`에서는 MCP tool call이 `user cancelled MCP tool call`로 취소됨. `codex exec --dangerously-bypass-approvals-and-sandbox`에서는 `terminallove_status`/`open_session` 호출 성공. status=`unread=0 · last_event=message · from=Claude · active_chat=yes · inbox=0`, 본문/코칭 미노출.
- 추가 검증: `npm run build && npm test` 통과(37/37).

## Phase 2 계획 (2026-06-01) — `PLAN.md`
- relay/directory는 현재 **로컬 공유 폴더**(서버 없음) → 서로 다른 머신은 통신 불가. Phase 2에서 **네트워크 relay/directory reference 서버**(Node 내장 http, 서명 인증, 본문 미열람) + 클라 **Transport 추상화**(LocalFs/Http, `TL_SERVER`로 전환, 하위호환) 구현.
- `/dating`이 Codex/Claude Code에 안 보이는 건 **방화벽 설계의 결과**(대화는 별도 `tl` 세션). 해결: `/dating` 런처 슬래시명령(CC `.claude/commands/dating.md`, Codex `~/.codex/prompts/dating.md`)이 별도 콘솔을 열거나 상태만 표시(본문 미노출) + REPL `/dating` prefix 수용.
- Phase 2A(transport 리팩터)→2B(서버+http+서명인증)→2C(크로스머신 E2E+보안)→2D(에이전트 UX)→2E(배포/Docker). 상세는 PLAN.md.
- 확정 결정(PLAN §8): 저장=파일(zero-dep), `/dating` 런처=새 터미널 자동 오픈(osascript)+폴백, **배포=외부배포 가능하게 제작 + 오픈소스 공개 전까지 admission gate(공유 액세스 토큰+선택 allowlist+TLS)로 "내부만", `TL_RELAY_OPEN`로 개방**, federation=후속(힌트 필드만 예약).
- 보안 2계층(§3.4): Layer1 admission(테스트 기간 ON, 토큰/allowlist) + Layer2 신원·E2E(항상 ON, 독립).
- **구현은 사용자 지시 대기** — "구현 ㄱㄱ" 시 Phase 2A 착수.
- 사용자 승인(2026-06-01): 추천 항목 **전부 채택**(법적/#8만 제외 — OSS라 불필요, 단 공개 hosted relay 직접 운영 시 운영자 책임은 별도). PLAN에 §10(확정·v1한계·백로그)·§11(멀티세션 동작)·**Phase 2F(AI-관찰 프로필 `--from-agent` + 별도세션 LLM 코칭 = 제품의 혼)** 추가. CI(`.github/workflows/ci.yml`) 추가.
- 멀티 터미널(같은 신원): 상태 락 + 전역 1:1 + envelope dedupe로 안전(§11). 멀티 디바이스(다른 머신·같은 신원)는 **ACK 전까지 relay 보관 + 로컬 dedupe** 결정.
- 미해결로 남긴 핵심: 제품의 혼(Phase 2F)·멀티디바이스 큐·키 평문(0600/암호화 백업)이 구현 시 우선.
