// Helper to spawn the relay/directory server as a child process for tests
// and local use. Launches src/server entry, waits for its TL_RELAY_LISTENING
// stdout marker to learn the OS-assigned port, and exposes graceful shutdown.
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface SpawnedServer {
  port: number;
  baseUrl: string;
  proc: ChildProcess;
  stderr: () => string;
  close: () => Promise<void>;
}

export interface SpawnOptions {
  env?: Record<string, string | undefined>;
  readyTimeoutMs?: number;
}

/**
 * Spawn the relay server on an ephemeral port (TL_RELAY_PORT=0) and resolve once
 * it prints "TL_RELAY_LISTENING <port>" on stdout, rejecting on early exit,
 * spawn error, or readiness timeout. Runs via tsx when invoked from a .ts entry.
 */
export function spawnRelayServer(opts: SpawnOptions = {}): Promise<SpawnedServer> {
  const selfPath = fileURLToPath(import.meta.url);
  const here = dirname(selfPath);
  const isTs = selfPath.endsWith(".ts");
  const serverEntry = join(here, isTs ? "server.ts" : "server.js");
  const nodeArgs = isTs ? ["--import", "tsx", serverEntry] : [serverEntry];

  const env: NodeJS.ProcessEnv = { ...process.env, TL_RELAY_PORT: "0", ...opts.env };
  const proc = spawn(process.execPath, nodeArgs, { env, stdio: ["ignore", "pipe", "pipe"] });

  let stderrBuf = "";
  proc.stderr?.on("data", (c: Buffer) => (stderrBuf += c.toString()));

  const readyTimeoutMs = opts.readyTimeoutMs ?? 15000;

  return new Promise<SpawnedServer>((res, rej) => {
    let stdoutBuf = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      rej(new Error(`relay server did not start in ${readyTimeoutMs}ms.\nstderr:\n${stderrBuf}`));
    }, readyTimeoutMs);

    proc.stdout?.on("data", (c: Buffer) => {
      stdoutBuf += c.toString();
      const m = stdoutBuf.match(/TL_RELAY_LISTENING (\d+)/);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        const port = Number(m[1]);
        res({
          port,
          baseUrl: `http://127.0.0.1:${port}`,
          proc,
          stderr: () => stderrBuf,
          close: () =>
            new Promise<void>((done) => {
              if (proc.exitCode !== null || proc.signalCode) return done();
              proc.once("exit", () => done());
              proc.kill("SIGTERM");
              // Escalate to SIGKILL if the process hasn't exited within 1.5s;
              // unref the timer so it never keeps the event loop alive.
              setTimeout(() => {
                if (proc.exitCode === null && !proc.signalCode) proc.kill("SIGKILL");
              }, 1500).unref?.();
            }),
        });
      }
    });

    proc.once("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rej(e);
    });
    proc.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rej(new Error(`relay server exited early (code ${code}).\nstderr:\n${stderrBuf}`));
    });
  });
}
