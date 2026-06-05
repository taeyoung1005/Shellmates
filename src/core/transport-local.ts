// Local filesystem-backed Transport: directory and relay live on disk under ctx,
// so this implementation just delegates to the directory/relay modules with no network.
import type { Ctx } from "./config.js";
import { lookupCard, publishCard, revokeCard, scanCards } from "./directory.js";
import { deleteEnvelope, pollEnvelopes, sendEnvelope } from "./relay.js";
import type { Transport, DirectoryQuery, PolledEnvelope } from "./transport.js";
import type { Envelope, PresenceInfo, ProfileCard, PublicProfileCard } from "./types.js";

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
    // Expose each on-disk envelope's file path as the opaque `ref` used to delete it later.
    return pollEnvelopes(this.ctx, myAgentId).map(({ env, path }) => ({ env, ref: path }));
  }

  deleteEnvelope(ref: string): void {
    deleteEnvelope(ref);
  }

  heartbeat(_agentId: string): PresenceInfo | null {
    void _agentId;
    return null;
  }
}
