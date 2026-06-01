// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
// Internal implementation note.
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Internal implementation note. */
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

/** Internal implementation note. */
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
