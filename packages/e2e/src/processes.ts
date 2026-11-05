import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const READY_ATTEMPTS = 120;
const READY_INTERVAL_MS = 500;

/** Runs a command to the end, failing loudly if it does. */
export function runToEnd(
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env, cwd: options.cwd, stdio: "inherit" });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)),
    );
  });
}

/** Waits until an address answers with success, or gives up. */
export async function waitUntilReady(url: string, what: string): Promise<void> {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    const isUp = await fetch(url)
      .then((response) => response.ok)
      .catch(() => false);
    if (isUp) {
      return;
    }
    await delay(READY_INTERVAL_MS);
  }
  throw new Error(`${what} did not start in time.`);
}

/** A port nothing else on this machine is using. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("No free port was found.")),
      );
    });
  });
}

/**
 * Builds (unless E2E_REUSE_BUILD=1, for rerunning while working on tests)
 * and starts a Next.js app in the current folder, and waits for its health
 * check.
 */
export async function startNextApp(options: {
  port: number;
  env: NodeJS.ProcessEnv;
}): Promise<{ stop(): void }> {
  if (process.env.E2E_REUSE_BUILD !== "1") {
    await runToEnd("pnpm", ["exec", "next", "build"], { env: options.env });
  }
  const server: ChildProcess = spawn(
    "pnpm",
    ["exec", "next", "start", "-p", String(options.port)],
    {
      env: options.env,
      stdio: "inherit",
    },
  );
  await waitUntilReady(`http://localhost:${options.port}/api/health`, "The app");
  return { stop: () => server.kill() };
}

/** Where a run keeps its sign-in files: the test login's cookies and authenticator key. */
const RUN_STATE_DIRECTORY = "e2e/.state";
/** Playwright's traces and screenshots: kept after a failure to look into, removed after a pass. */
const RESULTS_DIRECTORY = "test-results";

/**
 * What a run leaves in the app's folder, removed (review KL-8: "leave nothing
 * behind"): the sign-in files always, the results only once every test passed.
 */
export async function removeRunLeftovers(options: {
  appDirectory: URL;
  isPassed: boolean;
}): Promise<void> {
  const { rm } = await import("node:fs/promises");
  // From the app's own folder, never wherever the run happened to start.
  const inApp = (directory: string) => new URL(`${directory}/`, options.appDirectory);
  await rm(inApp(RUN_STATE_DIRECTORY), { recursive: true, force: true });
  if (options.isPassed) {
    await rm(inApp(RESULTS_DIRECTORY), { recursive: true, force: true });
  }
}
