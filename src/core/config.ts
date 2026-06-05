// Resolves runtime context: filesystem paths for local home/net state and
// optional relay/directory server config, all derived from environment
// variables with sensible defaults under the user's home directory.
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Relay/directory server endpoint plus an optional bearer access token. */
export interface ServerConfig {
  baseUrl: string;
  accessToken?: string;
}

export interface Ctx {
  home: string;
  net: string;
  directoryDir: string;
  relayDir: string;
  statePath: string; // home/state.json
  notifyPath: string;
  server: ServerConfig | null;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Picks the server base URL from TL_SERVER / TL_RELAY_URL / TL_DIRECTORY_URL
 * (in that order), returning null when none is set. Trims and strips trailing
 * slashes, and attaches TL_RELAY_ACCESS_TOKEN as the access token when present.
 */
export function resolveServer(env: NodeJS.ProcessEnv): ServerConfig | null {
  const raw = env.TL_SERVER || env.TL_RELAY_URL || env.TL_DIRECTORY_URL;
  if (!raw || !raw.trim()) return null;
  const baseUrl = stripTrailingSlash(raw.trim());
  const token = env.TL_RELAY_ACCESS_TOKEN?.trim();
  return token ? { baseUrl, accessToken: token } : { baseUrl };
}

export function resolveCtx(env: NodeJS.ProcessEnv = process.env): Ctx {
  const home = resolve(env.TL_HOME || env.SHELLMATES_HOME || join(homedir(), ".shellmates"));
  const net = resolve(env.TL_NET || env.SHELLMATES_NET || join(homedir(), ".shellmates-net"));
  return {
    home,
    net,
    directoryDir: join(net, "directory"),
    relayDir: join(net, "relay"),
    statePath: join(home, "state.json"),
    notifyPath: join(home, "notify.json"),
    server: resolveServer(env),
  };
}
