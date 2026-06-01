# TerminalLove — Phase 2 PLAN
## 네트워크 relay/directory 서버 + 에이전트 통합 UX

> 현재(Phase 1): relay/directory = **로컬 공유 폴더**(서버 없음). 같은 머신/공유 폴더만 통신 가능.
> Phase 2 목표: **서로 다른 머신이 네트워크로 연결**되는 self-host 가능한 reference 서버 + 클라이언트 전송 추상화, 그리고 `/dating`을 에이전트에서 발견 가능하게 만드는 UX. (기획서 §6 "누구나 운영 가능한 relay/directory", Phase 3~4 hosted layer의 코어를 당겨서 구현)

---

## 0. 설계 불변 원칙 (Phase 1에서 유지)
- **E2E 암호화 유지**: 서버는 `from/to/timestamp/size`(메타데이터)만, 본문(ciphertext)은 못 봄.
- **신원 = public key**: `agent_id = fingerprint(Ed25519 sign_pub)` (16 hex). 서버는 신원 발급 안 함.
- **사칭/위조 방지는 서명**: 서버가 보증하지 않음. 클라이언트가 최종 검증.
- **컨텍스트 방화벽 유지**: 대화/코칭은 별도 세션. 코딩 에이전트엔 알림/런처만.
- **하위 호환**: `TL_SERVER` 미설정 시 기존 로컬 폴더 모드로 동작.

---

## 1. `/dating` 가시성 문제 해결 (방화벽 유지)

문제: 코딩 에이전트에 `/dating` 슬래시 명령이 없음 → 의도된 방화벽 설계지만 디스커버리가 나쁨.

해결(권장안 A — 방화벽 유지 + 런처):
1. **`tl` REPL = "dating 콘솔"**: 별도 터미널에서 `tl`만 치면 대화형 콘솔. REPL이 `/dating scan`과 `scan` 둘 다 수용(기획서 표기 호환). ← 실제 사용 표면.
2. **Claude Code 커스텀 슬래시 명령** `.claude/commands/dating.md`(또는 `~/.claude/commands/`): `/dating` 입력 시
   - (기본) **새 터미널 탭/창에서 `tl` 콘솔을 띄움**(macOS `osascript`로 Terminal 탭 오픈) → 본문은 코딩 세션에 안 들어옴.
   - (대체) 터미널 자동 오픈 불가 환경이면 "여는 법 + `terminallove_status` 카운트"만 출력(본문 X).
3. **Codex 커스텀 프롬프트** `~/.codex/prompts/dating.md`: `/dating` 동일 동작(런처/안내).
4. **MCP**: 현행 알림 도구 유지. (선택) context-safe MCP **prompt** 추가 시 `/mcp__terminallove__open` 형태로도 노출 — 단 본문 미포함.

> **여러 터미널/중복 실행 안전성**: `/dating`를 여러 번 누르거나 창을 여러 개 열어도 안전 — 같은 신원(`TL_HOME`)의 상태를 공유하고 상태 파일 락 + 전역 1:1 불변식 + envelope dedupe로 직렬화/중복방지됨(§11). 단 UX상 런처는 **이미 열린 `tl` 콘솔이 있으면 새로 안 띄우고 포커스**(pidfile/창 제목 감지).

비권장안 B(참고): 방화벽 완화 — `/dating`를 코딩 세션 안에서 대화. → 당신이 명시한 방화벽 요구와 충돌하므로 채택하지 않음(원하면 옵션 플래그로 제공 가능).

산출물: `commands/dating.md`(CC), `prompts/dating.md`(Codex), REPL `/dating` prefix 수용, 설치 안내(SETUP.md 갱신).

---

## 2. 목표 아키텍처 (네트워크)

```
[사용자 A 머신]                         [relay/directory 서버]                      [사용자 B 머신]
 tl (CLI/REPL) ── HttpTransport ──► PUT/GET /directory  ◄── HttpTransport ── tl (CLI/REPL)
 tl-daemon     ── HttpTransport ──► POST/GET/DELETE /relay ◄────────────────  tl-daemon
   (Ed25519 서명 인증)                (메타데이터만; 본문은 암호문)              (Ed25519 서명 인증)
```
- 공식 서버 1개 = 기본값. 누구나 self-host(다른 URL). 클라는 URL만 바꾸면 됨(이메일/Git 느낌).

---

## 3. 서버 설계 (reference implementation)

- **런타임**: Node 내장 `http`(zero-dep) + 파일 백엔드(현 relay 폴더 모델 재사용) → 의존성 0 유지. (확장 시 SQLite 옵션)
- **상태 분리**: 서버 코드는 `src/server/`에. 클라 코어와 crypto/util 공유.

### 3.1 엔드포인트
| 메서드 | 경로 | 인증 | 동작 |
|---|---|---|---|
| GET | `/health` | - | 상태 |
| PUT | `/directory/:agentId` | 서명(owner) | 서명 카드 게시. 서버가 verifyCard(서명/owner바인딩/만료) 후 수락 |
| GET | `/directory?dir=<topic>&limit=` | - | 카드 목록(페이지네이션). 클라가 재검증 |
| GET | `/directory/:agentId` | - | 단일 카드 |
| DELETE | `/directory/:agentId` | 서명(owner) | 게시 철회 |
| POST | `/relay/:toAgentId` | (발신 서명 포함 봉투) | 봉투 큐잉. 서버는 형식/크기/`to`일치/rate만 검증, 본문 복호화 X |
| GET | `/relay/:agentId` | **서명 인증(소유자만)** | 내 inbox 봉투 목록 수신 |
| DELETE | `/relay/:agentId/:envId` | **서명 인증(소유자만)** | ack 후 삭제 |

### 3.2 인증 (계정 없음, 서명 기반)
- inbox 읽기/삭제는 **그 agent_id의 개인키 소유자만**. 안 그러면 누구나 남의 메타데이터를 읽음.
- 요청 헤더: `Authorization: TL-Sig v=0.1, agent_id=<id>, pub=<sign_pub b64url>, ts=<iso>, nonce=<b64url>, sig=<b64url>`
  - 서명 대상: `canonical({method, path, agent_id, ts, nonce})`.
  - 서버 검증: `fingerprint(pub)==agent_id` AND 서명 유효 AND `ts` 신선(±2분) AND nonce 미사용(replay 캐시).
- 클라 헬퍼: `crypto.signAuth(identity, method, path)` / 서버 `verifyAuth(headers)`.

### 3.3 저장/정책
- per-agent 큐: `serverData/relay/<agentId>/<envId>.json`(파일). 카드: `serverData/directory/<agentId>.json`.
- TTL: 봉투 기본 7일 후 만료 GC. 카드 expires_at 지나면 GET에서 제외.
- 안티어뷰즈: IP+agent_id rate limit, 봉투 크기 캡(예 64KB), inbox 큐 최대 길이(예 1000), intro 분당 제한, (선택) 등록 invite 토큰/PoW.

### 3.4 접근 제어 (admission gate) — 오픈소스 공개 전까지 "내부만"
보안을 2계층으로 분리한다. **외부 배포 가능하게 제작하되 기본은 잠금(closed beta).**
- **Layer 1 — admission(누가 서버에 접속 가능한가)**: 내부 테스트 기간 ON.
  - **공유 액세스 토큰** `TL_RELAY_ACCESS_TOKEN`: 모든 요청에 `X-TL-Access: <token>` 필요, 없으면 401. 내부 인원에게만 공유.
  - (선택) **agent_id allowlist**(`allowlist.json`): 등록/사용 가능한 public key만 허용.
  - (선택) **네트워크**: 공개 URL이면 TLS(HTTPS) 필수 + 방화벽/IP allowlist/VPN.
  - **토글**: `TL_RELAY_OPEN=true` 면 admission 해제(오픈소스 공개 시) → 누구나 self-host/접속.
- **Layer 2 — identity/integrity/privacy(항상 ON)**: 서명 인증(agent_id=fingerprint) + E2E 암호화 + 봉투 검증. admission과 독립적으로 늘 적용 → 토큰이 새도 본문/사칭은 별도로 보호됨.

---

## 4. 클라이언트 변경 (transport 추상화)

- **`Transport` 인터페이스**(`src/core/transport.ts`):
  `publishCard / revokeCard / scanCards / lookupCard / sendEnvelope / pollEnvelopes / deleteEnvelope`.
- 구현 2종:
  - `LocalFsTransport` — 현행 directory.ts/relay.ts 로직 이전(행동 동일).
  - `HttpTransport` — 위 서버 호출(서명 인증 포함, Node `fetch`).
- **config**: `TL_SERVER`(또는 `TL_DIRECTORY_URL`/`TL_RELAY_URL`). 있으면 Http, 없으면 LocalFs(하위호환).
- `directory.ts`/`relay.ts`는 활성 transport에 위임하는 얇은 래퍼로 전환.
- **engine/CLI/데몬/MCP/테스트 API는 불변** — transport만 교체되어 기존 37 테스트 유지.

---

## 5. 단계별 구현 (phases) & 완료 기준

- **Phase 2A — Transport 추상화 리팩터**
  directory/relay → Transport 인터페이스 + LocalFsTransport. 행동 불변.
  완료: 기존 37 테스트 그대로 그린, demo 통과.
- **Phase 2B — relay/directory HTTP 서버 + HttpTransport + 서명 인증**
  `src/server/` 서버, `signAuth/verifyAuth`, HttpTransport.
  완료: localhost 서버에 두 클라가 붙어 publish/scan/intro/accept/send 왕복(공유 폴더 없이).
- **Phase 2C — 크로스머신 E2E + 보안 테스트**
  완료: ① 미인증 `GET /relay/:id` 거부 ② 위조 봉투 클라 거부 ③ replay/oversize/rate 거부 ④ 서버는 본문 못 봄 확인 ⑤ 두 home(공유폴더 X, 서버만)으로 전체 플로우.
- **Phase 2D — 에이전트 통합 UX**
  `commands/dating.md`(CC), `prompts/dating.md`(Codex), REPL `/dating` prefix, SETUP 갱신.
  완료: `/dating`가 두 도구에서 콘솔을 열거나(본문 미노출) 상태를 보여줌. 실제 등록까지 실측.
- **Phase 2E — 배포/운영(외부 배포 + admission gate)**
  서버 Dockerfile, `npm run server`, **admission gate(액세스 토큰/allowlist/`TL_RELAY_OPEN` 토글)**, TLS/HTTPS 배포 노트(리버스 프록시), 메트릭/health, federation 힌트(agent_id의 home-relay).
  완료: 잠금 상태로 외부 배포(공개 URL이라도 토큰 없는 접속 401) + `docker run terminallove-relay` 한 줄 기동 + 공개 시 토글로 개방.
- **Phase 2F — 제품의 혼(차별점)**
  `tl profile --from-agent`: **로컬에서** `~/.claude/projects/**/*.jsonl`·codex history를 LLM으로 요약→성향 카드 초안(사용자 승인). + 별도 세션의 **실제 LLM 코칭**(dating 데이터만 시드: headless `claude -p`/`codex exec` 또는 API). 컨텍스트 방화벽 유지.
  완료: 플래그 없이 관찰 기반 프로필 생성 + 휴리스틱 대신 LLM 코칭.

---

## 6. 테스트 계획
- 단위: `signAuth/verifyAuth`(서명/만료/replay), transport 인터페이스 양 구현 동등성.
- 통합: localhost 서버 ↔ 클라 풀 플로우(HttpTransport).
- 보안: 미인증 inbox 읽기 403, 위조 봉투 클라 폐기, replay 차단, 크기/rate 한도, 서버 로그에 평문 없음 검증.
- admission: 토큰 없는 요청 401, allowlist 외 agent_id 등록/사용 거부, `TL_RELAY_OPEN=true` 시 개방 동작 확인.
- 크로스머신 시뮬: 공유 폴더 없이 서버 URL만으로 두 신원 매칭/대화.
- 서브에이전트 조작: HTTP 경유 라이브 매칭/대화 + 적대 에이전트(미인증 읽기/위조) 차단 확인.
- 회귀: 로컬 폴더 모드(TL_SERVER 미설정) 기존 37 테스트 유지.

---

## 7. 리스크 & 한계
- **메타데이터 노출**: 서버는 from/to/ts/size를 봄(본문 X) — 문서에 솔직 고지(기획서 §11과 동일 입장).
- **단일 relay SPOF/검열**: federation은 후속(Phase 2E 힌트 → 차기). v1은 "공식 1개 + 누구나 self-host".
- **스팸/어뷰즈**: rate limit/크기캡/invite로 1차 방어, 지속 과제.
- **NAT/배포**: self-host는 공개 URL/포트 필요(배포 노트 제공).

---

## 8. 확정된 결정 (2026-06-01)
1. **서버 저장 백엔드**: **파일 기반(zero-dep)**. (확장 시 SQLite는 후속)
2. **`/dating` 런처 동작**: **새 터미널 탭/창 자동 오픈**(macOS `osascript`)으로 `tl` 콘솔 기동 + 자동오픈 불가 환경 폴백(상태/안내만). 본문은 코딩 세션 미노출.
3. **배포 대상**: **외부 배포 가능하게 제작**(공개 URL/Docker/TLS 대응). 단 **오픈소스 공개 전까지는 admission gate(공유 액세스 토큰 + 선택 allowlist)로 "내부만" 접속**(§3.4). 내부 테스트는 이 잠금 상태로 진행(localhost/사내망), 공개 시 `TL_RELAY_OPEN`으로 개방.
4. **federation**: v1은 **단일 relay + home-relay 힌트 필드만 예약**(실제 federation은 후속).

**구현 시점**: 사용자 지시 대기 — 이번엔 PLAN까지. "구현 ㄱㄱ" 하면 Phase 2A부터 착수.

---

## 9. 영향받는/신규 파일 (요약)
- 신규: `src/core/transport.ts`, `src/core/transport-local.ts`, `src/core/transport-http.ts`, `src/server/server.ts`, `src/server/store-server.ts`, `commands/dating.md`, `prompts/dating.md`, `test/server.test.ts`, `test/transport.test.ts`, `Dockerfile`.
- 변경: `config.ts`(TL_SERVER), `crypto.ts`(signAuth/verifyAuth), `directory.ts`/`relay.ts`(위임), `cli.ts`(REPL `/dating` prefix), `package.json`(server 스크립트/bin), `README.md`/`SETUP.md`.
- 불변: `engine.ts`, `messaging.ts`, `profile.ts`, `matching.ts`, `safety.ts`, `coaching.ts`, `mcp/server.ts`, `daemon.ts`(transport만 교체).

---

## 10. 추가 확정 결정 · v1 한계 · 백로그 (2026-06-01, 사용자 승인 — 법적/age-gate는 OSS라 제외)

**확정 (구현 시 반영)**
- **멀티 디바이스/배달**: relay는 **ACK 전까지 봉투 보관(+TTL)**, GET이 hard-delete 안 함. 클라가 `env.id`로 로컬 dedupe → 여러 기기/창에서도 안전.
- **디렉토리 스케일**: 서버 coarse 필터 `?dir=&mode=&country=&limit=&cursor=` + 페이지네이션. 매칭 점수는 로컬 유지.
- **키 관리/시크릿**: `backup-key`는 **패스프레이즈 암호화**, `state.json`·키파일 **0600 권한**, 멀티기기는 `import-key`. `rotate-key`는 (선택)이전 키 연결 공지.
- **Sybil/스팸**: 등록 invite 토큰/PoW + GitHub/domain proof + reputation(점진).
- **데몬 상시화**: launchd/systemd 서비스 템플릿 제공(미기동 시 알림 누락 방지).
- **런처 idempotency**: 이미 열린 콘솔 포커스(중복 창 방지).

**v1 한계 (솔직 문서화)**
- **Forward secrecy 없음**(static X25519): `box_priv` 유출 시 과거 메시지 복호화 가능. (후속: Double Ratchet 검토)
- **메타데이터 노출**: relay가 from/to/size를 봄. (후속: sealed-sender/패딩)
- **단일 relay SPOF**: federation 후속.
- **법적/age-gate(#8)**: 사용자 결정으로 v1 스코프 제외(오픈소스·self-host 전제). 단 **공개 hosted relay를 직접 운영**하면 운영자 책임은 별도로 남음(주의).

**백로그**
- CI(GitHub Actions: typecheck+test), 네이밍/도메인/상표 확인, 글로벌 번역(LLM), Verified Client 배지, **콜드스타트 시딩/런치 모먼트**(기획서 최대 리스크).

---

## 11. 멀티 세션/디바이스 동작 (설계 보장)
- **같은 머신·같은 신원·여러 창**: 같은 `TL_HOME/state.json` 공유. `Engine.tx`의 **상태 파일 락**으로 reload→mutate→save 직렬화 → lost-update 없음. 전역 1:1 불변식이라 창마다 다른 대화로 갈리지 않음(동일 단일 대화 뷰). 동시 `accept`/`send`도 락 직렬화, 두 번째 accept는 "이미 대화 중"으로 거부. relay 봉투는 락+`seen_env`로 정확히 1회 처리.
- **다른 신원(테스트)**: 창마다 다른 `TL_HOME`(같은 `TL_NET`) → 독립 신원(Alice/Bob 시뮬, 현 demo 방식).
- **다른 머신·같은 신원(멀티 디바이스)**: state.json 비공유 → §10의 ACK-보관 + 로컬 dedupe로 양 기기 모두 수신.
