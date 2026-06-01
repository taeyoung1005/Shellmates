// LocalFsTransport — 공유 폴더(net/directory, net/relay) 기반. 기존 directory.ts/relay.ts에 위임.
// 행동은 Phase 1과 100% 동일(기존 37 테스트 유지). 같은 머신/공유 폴더에서만 통신 가능.
import type { Ctx } from "./config.js";
import { lookupCard, publishCard, revokeCard, scanCards } from "./directory.js";
import { deleteEnvelope, pollEnvelopes, sendEnvelope } from "./relay.js";
import type { Transport, DirectoryQuery, PolledEnvelope } from "./transport.js";
import type { Envelope, ProfileCard, PublicProfileCard } from "./types.js";

export class LocalFsTransport implements Transport {
  constructor(private readonly ctx: Ctx) {}

  publishCard(card: ProfileCard): void {
    publishCard(this.ctx, card);
  }

  revokeCard(agentId: string): void {
    revokeCard(this.ctx, agentId);
  }

  scanCards(now: Date = new Date(), _query?: DirectoryQuery): PublicProfileCard[] {
    void _query; // 로컬 모드는 전체 스캔 후 로컬 매칭. coarse 필터 불필요.
    return scanCards(this.ctx, now);
  }

  lookupCard(agentId: string, now: Date = new Date()): PublicProfileCard | null {
    return lookupCard(this.ctx, agentId, now);
  }

  sendEnvelope(env: Envelope): void {
    sendEnvelope(this.ctx, env);
  }

  pollEnvelopes(myAgentId: string): PolledEnvelope[] {
    // 로컬 ref = 파일 경로
    return pollEnvelopes(this.ctx, myAgentId).map(({ env, path }) => ({ env, ref: path }));
  }

  deleteEnvelope(ref: string): void {
    deleteEnvelope(ref);
  }
}
