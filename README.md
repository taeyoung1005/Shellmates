# TerminalLove

> AI 에이전트 간 소개팅 프로토콜 (Agent Dating Protocol)
> **개발하다가 터미널에서 소개팅한다.** — Your agent knows you. The protocol only connects you.

개발 에이전트(Claude Code · Codex · Cursor) 안에서 작동하는 **오픈소스 에이전트 간 소개팅 프로토콜**. 별도 데이팅 앱을 켜지 않고, 평소 쓰는 개발 에이전트 옆에서 매칭·대화가 일어납니다. 데이터는 로컬에 남고, 프로필은 서명되며, 메시지는 E2E 암호화되고, **소개팅 활동은 코딩 세션 컨텍스트와 완전히 격리**됩니다.

전체 기획은 [`기획서.md`](./기획서.md) 참고.

---

## 핵심 특징

- **로컬 우선 (local-first)**: 성향 분석·매칭이 전부 로컬에서 일어나고, 사용자가 승인한 공개 프로필만 공유.
- **public key 신원**: Ed25519 키페어. `agent_id = fingerprint(sign_pub)`. 사칭 불가(서명 + 바인딩 검증).
- **서명된 프로필 카드**: 변조 시 검증 실패, 기본 7일 만료.
- **E2E 암호화 1:1 대화**: X25519 ECDH → HKDF → AES-256-GCM. relay는 from/to/size만 보고 본문은 못 봄.
- **1:1 전용**: 동시 활성 대화는 0~1개. 새 매칭 전 `end` 필요 → 구현·관리·안전 단순.
- **차단/언매치**: 일방향 `block`(조용한 차단), `end`(언매치 + 재추천 제외), `report`.
- **컨텍스트 방화벽**: 메시지/코칭은 코딩 세션 컨텍스트에 절대 들어가지 않음. 알림은 out-of-band(데몬 사운드/카운트), 대화는 별도 세션.
- **완전 오픈소스 / 비영리**: 수익화 모델 없음. hosted directory/relay는 무료·커뮤니티 인프라.

---

## 빠른 시작

```bash
npm install
npm run build        # dist/ 로 컴파일
npm test             # 단위/통합/MCP 테스트 (node:test)
npm run demo         # 단일 머신 E2E 데모 (Alice/Bob + 보안 시나리오)
```

요구사항: Node ≥ 20 (개발은 Node 24 검증). 암호화는 Node 내장 `crypto`(Ed25519/X25519)만 사용 — 외부 암호 의존성 없음.

---

## 단일 머신 데모

```bash
npm run demo
```

한 프로세스에서 두 신원(Alice/Bob)을 시뮬레이션해 전체 플로우를 보여줍니다:
`init → profile → publish → scan → intro → accept → open → coach → send → end`,
그리고 보안 시나리오(사칭/미매칭/replay/카드 변조/프롬프트 인젝션 플래그)까지 단언과 함께 검증합니다.

---

## CLI 사용법 (별도 세션)

TerminalLove 대화는 코딩 세션과 분리된 **별도 터미널**에서 진행합니다.

```bash
# 데이터 경로: TL_HOME(내 신원), TL_NET(공유 네트워크: 디렉토리+relay)
export TL_HOME=~/.terminallove
export TL_NET=~/.terminallove-net

npm run cli -- init                                  # 키페어 생성
npm run cli -- profile --name 나 --country Korea \
   --langs "Korean,English" --stacks "TypeScript,Rust" \
   --interests "AI Products,Side Projects" --modes "dating,builder" --hours night
npm run cli -- publish                               # 디렉토리에 서명 프로필 게시
npm run cli -- scan                                  # 매칭 후보(로컬 계산)
npm run cli -- intro <agent_id> "첫 메시지"           # 소개 요청 (활성 대화 없을 때만)
npm run cli -- inbox                                 # 받은 intro
npm run cli -- accept <intro_id>                     # 수락 → 1:1 대화 시작
npm run cli -- open                                  # 현재 대화 + 코치
npm run cli -- send "메시지"                          # 전송
npm run cli -- reply                                 # 답장 코칭
npm run cli -- coach "초안"                           # 초안 보정 코칭
npm run cli -- end [--block]                         # 종료(언매치) [+차단]
npm run cli -- block [agent_id]                      # 일방향 차단
npm run cli -- report <agent_id> [사유]               # 신고
npm run cli -- alias <별명> | status | notify | help
```

인자 없이 실행하면 대화형 REPL이 열립니다: `npm run cli`. 모든 명령에 `--json`을 붙이면 기계 판독용 JSON을 출력합니다.

### intro vs send 규칙 (1:1)
- `agent_id`로는 **intro만** 가능. `send`/`reply`는 수락된 **현재 대화**에만.
- 활성 대화가 있으면 새 `intro` 불가 → `end`로 종료 후 가능.

---

## 데몬 — out-of-band 알림 (컨텍스트 방화벽)

```bash
npm run daemon          # relay watch, 새 메시지 시 사운드 + "🔔 N unread" (본문 없음)
npm run daemon -- --once  # 1회 폴링 후 종료(테스트용). JSON {ingested,rejected,events} 출력
```

데몬은 **카운트/이벤트/발신 alias만** 표시하고 **메시지 본문·코칭은 절대 출력하지 않습니다.** 본문은 오직 `open`(별도 세션)에서만 보입니다.

---

## MCP 연결 (Claude Code / Codex) — thin & context-safe

메인 코딩 세션에 붙는 MCP 서버는 **본문/코칭을 노출하지 않습니다.** 오직 알림 카운트와 "별도 세션 여는 법"만 제공합니다(컨텍스트 방화벽).

```bash
# Claude Code 예시
claude mcp add terminallove -- node /절대경로/TerminalLove/dist/src/mcp/server.js
```

노출 도구: `terminallove_status`(카운트만) · `terminallove_open_session`(여는 법 안내). 실제 대화는 별도 `npm run cli` 세션에서.

> 왜 별도 세션인가: Claude Code·Codex 모두 MCP tool 결과와 subagent 요약이 메인 컨텍스트로 들어갑니다. 따라서 대화/코칭은 별도 프로세스/세션에서만 다루고, 메인에는 알림 한 줄만 둡니다. (자세한 근거는 기획서 §10.4.1)

---

## 아키텍처 (5 레이어)

```
src/core/
  identity ─ crypto.ts      Ed25519 서명, X25519 E2E, agent_id fingerprint
  profile  ─ profile.ts     서명된 프로필 카드(만료/검증)
  discovery─ directory.ts   공유 디렉토리 publish/scan + 서명검증
             matching.ts    로컬 호환도 점수 + 사유
  messaging─ relay.ts       암호 봉투 전달(내용 비가시)
             messaging.ts   intro→accept→1:1 대화, ingest 검증(서명/바인딩/replay/미매칭)
             safety.ts      프롬프트 인젝션/연락처 sanitize
  agent-ux ─ coaching.ts    격리된 대화 코칭(소개팅 데이터만)
             engine.ts      상위 오케스트레이션 API
  공통     ─ types.ts config.ts store.ts util.ts

src/cli/cli.ts        별도 세션 표면(/dating REPL + 원샷 + --json)
src/daemon/daemon.ts  백그라운드 watcher + out-of-band 알림
src/mcp/server.ts     thin·context-safe MCP 서버
src/tools/attack.ts   적대적 주입 테스트 도구
src/demo/demo.ts      단일 머신 E2E 데모
```

---

## 보안 모델

| 위협 | 방어 |
|---|---|
| 사칭(다른 사람인 척) | 모든 봉투 Ed25519 서명 + `from == fingerprint(sign_pub)` 바인딩 검증 |
| 메시지 위조/변조 | 서명 검증 실패 시 폐기 |
| replay | envelope id dedupe(seen_env) + nonce + 서명이 id/시각 포함 |
| 미매칭 DM | intro-first. 활성 대화의 상대가 아니면 메시지 거부 |
| 프로필 변조 | 카드 서명 + owner 바인딩 + 만료 검증 |
| 프롬프트 인젝션 | 수신 메시지는 untrusted. sanitize + flag, 시스템 지시/도구 실행으로 절대 해석 안 함 |
| 컨텍스트 오염 | 본문/코칭은 코딩 세션 컨텍스트 미주입(별도 세션 + out-of-band 알림) |
| 도청 | E2E 암호화(X25519+AES-256-GCM). relay는 메타데이터만(솔직 고지) |

---

## 테스트

```bash
npm run typecheck   # tsc --noEmit
npm test            # node:test 단위/통합/MCP
npm run demo        # E2E 데모(단언 포함)
```

---

## 라이선스

MIT — [`LICENSE`](./LICENSE)
