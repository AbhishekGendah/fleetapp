/**
 * Runs the browser tests end to end: a throwaway Postgres with the real
 * migrations, one test Admin, the admin app built and started against it,
 * then Playwright. Everything is torn down afterwards, pass or fail.
 *
 * Usage: pnpm --filter admin e2e
 * Only made-up data, on a database that exists for this run only.
 */
import { describeErrorForLog } from "@fleetapp/core";
import { inArray } from "drizzle-orm";
import { createDb } from "@fleetapp/db/client";
import { operators, vehicles } from "@fleetapp/db/schema";
import {
  ADMIN_APP_ROLE,
  ADMIN_AUTH_ROLE,
  APPLICATION_ROLES,
  WEB_APP_ROLE,
} from "@fleetapp/db/tenancy";
import { withTenant } from "@fleetapp/db/tenant-context";
import { migrateTestDatabase, startTestPostgres } from "@fleetapp/db/testing";
import { removeRunLeftovers, runToEnd, startNextApp } from "@fleetapp/e2e/processes";

import { createAdminAuth } from "../src/lib/auth-options";
import { createFirstAdmin } from "../src/lib/create-first-admin";
import { E2E_ADMIN, E2E_BASE_URL, E2E_OPERATORS, E2E_PORT, E2E_TYPED_CARS } from "./e2e-settings";

const EXIT_FAILURE = 1;
/** The app's folder, one up from this file. */
const APP_DIRECTORY = new URL("..", import.meta.url);
const TEST_SECRET = "an-e2e-only-signing-secret-of-32-chars-or-more";

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
    APP_STAGE: "development",
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
async function seedOperators(adminDatabaseUrl: string): Promise<Map<string, string>> {
  const database = createDb(adminDatabaseUrl);
  // Made with a name, then paused, as the admin app does it (review A9-3).
  const made = await database
    .insert(operators)
    .values(E2E_OPERATORS.map((operator) => ({ legalName: operator.legalName })))
    .returning({ id: operators.id, legalName: operators.legalName });
  const pausedNames = new Set<string>(
    E2E_OPERATORS.filter((operator) => operator.isSuspended).map((operator) => operator.legalName),
  );
  const pausedIds = made.filter((row) => pausedNames.has(row.legalName)).map((row) => row.id);
  if (pausedIds.length > 0) {
    await database
      .update(operators)
      .set({ suspendedAt: new Date() })
      .where(inArray(operators.id, pausedIds));
  }
  return new Map(made.map((row) => [row.legalName, row.id]));
}

/** Cars an Operator typed that are not in the list, made as the Operator app makes them. */
async function seedTypedCars(webDatabaseUrl: string, operatorId: string): Promise<void> {
  await withTenant(createDb(webDatabaseUrl), operatorId, (tx) =>
    tx.insert(vehicles).values(
      E2E_TYPED_CARS.regos.map((rego) => ({
        operatorId,
        rego,
        regoState: "WA" as const,
        make: E2E_TYPED_CARS.make,
        model: E2E_TYPED_CARS.model,
        year: 2024,
      })),
    ),
  );
}

async function main(): Promise<void> {
  const postgres = await startTestPostgres(APPLICATION_ROLES);
  let server: { stop(): void } | null = null;
  // Only a full pass removes the results; a failure keeps them to look into.
  let isPassed = false;
  try {
    await migrateTestDatabase(postgres.ownerUrl);
    const authDatabaseUrl = postgres.urlForRole(ADMIN_AUTH_ROLE);
    await seedAdmin(authDatabaseUrl);
    const adminDatabaseUrl = postgres.urlForRole(ADMIN_APP_ROLE);
    const operatorIds = await seedOperators(adminDatabaseUrl);
    await seedTypedCars(
      postgres.urlForRole(WEB_APP_ROLE),
      operatorIds.get(E2E_TYPED_CARS.operatorLegalName)!,
    );
    const env = appEnv(adminDatabaseUrl, authDatabaseUrl);
    server = await startNextApp({ port: E2E_PORT, env });
    await runToEnd("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], {
      env: { ...env, E2E_OWNER_URL: postgres.ownerUrl },
    });
    isPassed = true;
  } finally {
    try {
      server?.stop();
      await postgres.stop();
    } finally {
      await removeRunLeftovers({ appDirectory: APP_DIRECTORY, isPassed });
    }
  }
}

main().catch((error: unknown) => {
  console.error("The browser tests failed", describeErrorForLog(error));
  process.exit(EXIT_FAILURE);
});
