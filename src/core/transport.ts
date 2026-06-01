// Transport 추상화 — directory/relay 접근을 로컬 폴더(LocalFs)와 네트워크 서버(Http) 양쪽에 대해 통일.
// 설계 불변(PLAN §0): 서버는 메타데이터만, 본문은 암호문. 신원=public key. 최종 검증은 클라이언트.
import type { Ctx } from "./config.js";
import { HttpTransport } from "./transport-http.js";
import { LocalFsTransport } from "./transport-local.js";
import type { Envelope, Identity, ProfileCard, PublicProfileCard } from "./types.js";

/** poll로 가져온 봉투 + 삭제(ack)용 불투명 참조(ref). LocalFs=파일경로, Http=envelope id. */
export interface PolledEnvelope {
  env: Envelope;
  ref: string;
}

export interface DirectoryQuery {
  mode?: string; // 선택적 coarse 필터(서버측). 매칭 점수는 클라가 로컬 계산.
  country?: string;
  limit?: number; // 페이지 크기(Http). 전체는 cursor 페이지네이션으로 순회.
}

/**
 * directory + relay 접근 추상화.
 * 모든 메서드는 동기(엔진/CLI/테스트 API 불변 유지). Http 구현은 syncFetch로 블로킹.
 */
export interface Transport {
  // directory
  publishCard(card: ProfileCard): void;
  revokeCard(agentId: string): void;
  scanCards(now?: Date, query?: DirectoryQuery): PublicProfileCard[];
  lookupCard(agentId: string, now?: Date): PublicProfileCard | null;
  // relay
  sendEnvelope(env: Envelope): void;
  pollEnvelopes(myAgentId: string): PolledEnvelope[];
  deleteEnvelope(ref: string): void;
}

/**
 * 활성 transport 생성. ctx.server가 있으면 Http, 없으면 LocalFs(하위 호환).
 * getIdentity: Http가 inbox 읽기/삭제 시 서명 인증에 사용(현재 신원을 lazy하게 읽음).
 */
export function getTransport(ctx: Ctx, getIdentity: () => Identity | null = () => null): Transport {
  if (ctx.server) return new HttpTransport(ctx.server.baseUrl, getIdentity, ctx.server.accessToken);
  return new LocalFsTransport(ctx);
}
