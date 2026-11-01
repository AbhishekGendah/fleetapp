/**
 * Runs the browser tests end to end: a throwaway Postgres with the real
 * migrations, one test Admin, the admin app built and started against it,
 * then Playwright. Everything is torn down afterwards, pass or fail.
 *
 * Usage: pnpm --filter admin e2e
 * Only made-up data, on a database that exists for this run only.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { describeErrorForLog } from "@fleetapp/core";
import { createDb } from "@fleetapp/db/client";
import { operators } from "@fleetapp/db/schema";
import { ADMIN_APP_ROLE, ADMIN_AUTH_ROLE, APPLICATION_ROLES } from "@fleetapp/db/tenancy";
import { migrateTestDatabase, startTestPostgres } from "@fleetapp/db/testing";

import { createAdminAuth } from "../src/lib/auth-options";
import { createFirstAdmin } from "../src/lib/create-first-admin";
import { E2E_ADMIN, E2E_BASE_URL, E2E_OPERATORS, E2E_PORT } from "./e2e-settings";

const SERVER_READY_ATTEMPTS = 120;
const SERVER_READY_INTERVAL_MS = 500;
const EXIT_FAILURE = 1;
const TEST_SECRET = "an-e2e-only-signing-secret-of-32-chars-or-more";

/** Runs a command to the end, failing loudly if it does. */
function runToEnd(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)),
    );
  });
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < SERVER_READY_ATTEMPTS; attempt += 1) {
    const isUp = await fetch(`${E2E_BASE_URL}/api/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (isUp) {
      return;
    }
    await delay(SERVER_READY_INTERVAL_MS);
  }
  throw new Error("The admin app did not start in time.");
}

function appEnv(databaseUrl: string, authDatabaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ADMIN_URL: E2E_BASE_URL,
    APP_URL: "http://localhost:3000",
    DATABASE_URL: databaseUrl,
    AUTH_DATABASE_URL: authDatabaseUrl,
    BETTER_AUTH_SECRET: TEST_SECRET,
    AUTH_ISSUER_NAME: "E2E",
    EMAIL_TRANSPORT: "dev_outbox",
    EMAIL_FROM: "E2E <no-reply@example.test>",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

async function seedAdmin(authDatabaseUrl: string): Promise<void> {
  const database = createDb(authDatabaseUrl);
  await createFirstAdmin({
    database,
    auth: createAdminAuth({
      database,
      baseURL: E2E_BASE_URL,
      secret: TEST_SECRET,
      issuerName: "E2E",
      recordActivity: async () => undefined,
    }),
    email: E2E_ADMIN.email,
    fullName: E2E_ADMIN.fullName,
    password: E2E_ADMIN.password,
  });
}

/** A few made-up Operators for the list tests, one of them suspended. */
async function seedOperators(adminDatabaseUrl: string): Promise<void> {
  await createDb(adminDatabaseUrl)
    .insert(operators)
    .values(
      E2E_OPERATORS.map((operator) => ({
        legalName: operator.legalName,
        suspendedAt: operator.isSuspended ? new Date() : null,
      })),
    );
}

async function main(): Promise<void> {
  const postgres = await startTestPostgres(APPLICATION_ROLES);
  let server: ChildProcess | null = null;
  try {
    await migrateTestDatabase(postgres.ownerUrl);
    const authDatabaseUrl = postgres.urlForRole(ADMIN_AUTH_ROLE);
    await seedAdmin(authDatabaseUrl);
    const adminDatabaseUrl = postgres.urlForRole(ADMIN_APP_ROLE);
    await seedOperators(adminDatabaseUrl);
    const env = appEnv(adminDatabaseUrl, authDatabaseUrl);
    // Set E2E_REUSE_BUILD=1 to rerun tests against the last build while working on them.
    if (process.env.E2E_REUSE_BUILD !== "1") {
      await runToEnd("pnpm", ["exec", "next", "build"], env);
    }
    server = spawn("pnpm", ["exec", "next", "start", "-p", String(E2E_PORT)], {
      env,
      stdio: "inherit",
    });
    await waitForServer();
    await runToEnd("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], {
      ...env,
      E2E_OWNER_URL: postgres.ownerUrl,
    });
  } finally {
    server?.kill();
    await postgres.stop();
  }
}

main().catch((error: unknown) => {
  console.error("The browser tests failed", describeErrorForLog(error));
  process.exit(EXIT_FAILURE);
});
