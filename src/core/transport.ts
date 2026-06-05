// Transport abstraction over the directory + relay backend.
// Selects an HTTP relay/directory server or a local-filesystem fallback.
import type { Ctx } from "./config.js";
import { HttpTransport } from "./transport-http.js";
import { LocalFsTransport } from "./transport-local.js";
import type { Envelope, Identity, PresenceInfo, ProfileCard, PublicProfileCard } from "./types.js";

/** A relayed envelope plus the backend ref used to delete it after processing. */
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
 * Backend interface for the directory (profile cards) and relay (envelopes).
 * Implemented by both the HTTP server client and the local-filesystem fallback.
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
 * Picks the transport for the current context: the HTTP relay when a server is
 * configured (passing identity for signed requests), otherwise the local fallback.
 */
export function getTransport(ctx: Ctx, getIdentity: () => Identity | null = () => null): Transport {
  if (ctx.server) return new HttpTransport(ctx.server.baseUrl, getIdentity, ctx.server.accessToken);
  return new LocalFsTransport(ctx);
}
