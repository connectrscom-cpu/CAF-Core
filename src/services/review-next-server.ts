import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../config.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export type ReviewServerHandle = {
  upstream: string;
  child: ChildProcess | null;
  stop: () => Promise<void>;
};

function defaultStandaloneDir(): string {
  return path.join(repoRoot, "apps", "review", ".next", "standalone");
}

export function resolveReviewStandaloneDir(config: AppConfig): string {
  const configured = config.CAF_REVIEW_STANDALONE_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.env.CAF_REVIEW_STANDALONE_DIR?.trim()) {
    return path.resolve(process.env.CAF_REVIEW_STANDALONE_DIR.trim());
  }
  return defaultStandaloneDir();
}

function reviewChildEnv(config: AppConfig, port: number): NodeJS.ProcessEnv {
  const coreBase = `http://127.0.0.1:${config.PORT}`;
  const publicBase =
    config.CAF_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    `http://localhost:${config.PORT}`;

  return {
    ...process.env,
    NODE_ENV: config.NODE_ENV,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    CAF_CORE_URL: coreBase,
    CAF_CORE_TOKEN: config.CAF_CORE_API_TOKEN ?? process.env.CAF_CORE_TOKEN ?? "",
    NEXT_PUBLIC_APP_URL: publicBase,
    RENDERER_BASE_URL: config.RENDERER_BASE_URL,
  };
}

async function waitForReviewReady(upstream: string, log: (msg: string) => void, timeoutMs = 120_000): Promise<void> {
  const started = Date.now();
  const probePaths = ["/api/health/core", "/"];
  while (Date.now() - started < timeoutMs) {
    for (const probe of probePaths) {
      try {
        const res = await fetch(`${upstream}${probe}`, { cache: "no-store" });
        if (res.status < 500) {
          log(`Review app ready (${probe} → HTTP ${res.status})`);
          return;
        }
      } catch {
        // not ready yet
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Review app did not become ready within ${timeoutMs}ms (${upstream})`);
}

function spawnReviewDev(config: AppConfig, port: number, log: (msg: string) => void): ChildProcess {
  const reviewDir = path.join(repoRoot, "apps", "review");
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(cmd, ["next", "dev", "-p", String(port)], {
    cwd: reviewDir,
    env: reviewChildEnv(config, port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (buf) => log(`[review] ${String(buf).trimEnd()}`));
  child.stderr?.on("data", (buf) => log(`[review] ${String(buf).trimEnd()}`));
  child.on("exit", (code, signal) => {
    if (code != null && code !== 0) log(`[review] exited code=${code}`);
    if (signal) log(`[review] exited signal=${signal}`);
  });
  return child;
}

function spawnReviewStandalone(
  config: AppConfig,
  port: number,
  standaloneDir: string,
  log: (msg: string) => void
): ChildProcess {
  const serverJs = path.join(standaloneDir, "server.js");
  if (!existsSync(serverJs)) {
    throw new Error(
      `Review standalone server not found at ${serverJs}. Run: cd apps/review && npm run build`
    );
  }
  const child = spawn(process.execPath, [serverJs], {
    cwd: standaloneDir,
    env: reviewChildEnv(config, port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (buf) => log(`[review] ${String(buf).trimEnd()}`));
  child.stderr?.on("data", (buf) => log(`[review] ${String(buf).trimEnd()}`));
  child.on("exit", (code, signal) => {
    if (code != null && code !== 0) log(`[review] exited code=${code}`);
    if (signal) log(`[review] exited signal=${signal}`);
  });
  return child;
}

export async function startReviewNextServer(
  config: AppConfig,
  log: (msg: string) => void
): Promise<ReviewServerHandle> {
  const port = config.CAF_REVIEW_PORT;
  const upstream = `http://127.0.0.1:${port}`;
  const standaloneDir = resolveReviewStandaloneDir(config);
  const useDev =
    config.CAF_REVIEW_DEV ||
    (config.NODE_ENV === "development" && !existsSync(path.join(standaloneDir, "server.js")));

  log(
    useDev
      ? `Starting Review (next dev) on ${upstream}`
      : `Starting Review (standalone) from ${standaloneDir} on ${upstream}`
  );

  const child = useDev
    ? spawnReviewDev(config, port, log)
    : spawnReviewStandalone(config, port, standaloneDir, log);

  await waitForReviewReady(upstream, log);

  return {
    upstream,
    child,
    stop: async () => {
      if (!child.pid) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
          resolve();
        }, 5_000);
        child.on("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
}
