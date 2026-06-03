// Internal implementation note.
// Internal implementation note.
import type { Ctx } from "./config.js";
import { HttpTransport } from "./transport-http.js";
import { LocalFsTransport } from "./transport-local.js";
import type { Envelope, Identity, PresenceInfo, ProfileCard, PublicProfileCard } from "./types.js";

/** Internal implementation note. */
export interface PolledEnvelope {
  env: Envelope;
  ref: string;
}

export interface DirectoryQuery {
  mode?: string;
  country?: string;
  limit?: number;
}

/**
 * Internal implementation note.
 * Internal implementation note.
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
  heartbeat(agentId: string): PresenceInfo | null;
}

/**
 * Internal implementation note.
 * Internal implementation note.
 */
export function getTransport(ctx: Ctx, getIdentity: () => Identity | null = () => null): Transport {
  if (ctx.server) return new HttpTransport(ctx.server.baseUrl, getIdentity, ctx.server.accessToken);
  return new LocalFsTransport(ctx);
}
