// Internal implementation note.
// Internal implementation note.
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
    void _query;
    return scanCards(this.ctx, now);
  }

  lookupCard(agentId: string, now: Date = new Date()): PublicProfileCard | null {
    return lookupCard(this.ctx, agentId, now);
  }

  sendEnvelope(env: Envelope): void {
    sendEnvelope(this.ctx, env);
  }

  pollEnvelopes(myAgentId: string): PolledEnvelope[] {
    // Internal implementation note.
    return pollEnvelopes(this.ctx, myAgentId).map(({ env, path }) => ({ env, ref: path }));
  }

  deleteEnvelope(ref: string): void {
    deleteEnvelope(ref);
  }
}
