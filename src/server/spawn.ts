// relay 서버를 별도 프로세스로 기동하는 헬퍼(데모/테스트 공용).
// 별도 프로세스여야 하는 이유: 클라이언트의 syncFetch는 execFileSync로 메인 이벤트루프를 블로킹한다.
// 서버가 같은 프로세스에 있으면 응답을 못 해 데드락 → 반드시 분리 프로세스(= 실제 크로스머신과 동일).
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

/** server.ts(tsx) 또는 server.js(dist)를 자식 프로세스로 띄우고 리스닝 포트를 회수. */
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
              // 안전망: 1.5초 내 미종료 시 SIGKILL
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
