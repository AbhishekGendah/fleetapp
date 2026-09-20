import { fileURLToPath } from "node:url";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { TestProject } from "vitest/node";

import { ADMIN_APP_ROLE, WEB_APP_ROLE } from "../src/tenancy";
import { startTestPostgres } from "./test-postgres";

const MIGRATIONS_FOLDER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

declare module "vitest" {
  export interface ProvidedContext {
    webRoleUrl: string;
    superuserUrl: string;
    adminRoleUrl: string;
    ownerUrl: string;
  }
}

/**
 * Starts one Postgres for the whole run and applies the real migration files
 * to it. The tests then connect as the real application roles, so what they
 * prove about tenant isolation is what production will actually do.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const postgres = await startTestPostgres([WEB_APP_ROLE, ADMIN_APP_ROLE]);

  const migrationPool = new Pool({ connectionString: postgres.ownerUrl });
  try {
    await migrate(drizzle(migrationPool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await migrationPool.end();
  }

  project.provide("ownerUrl", postgres.ownerUrl);
  project.provide("superuserUrl", postgres.superuserUrl);
  project.provide("webRoleUrl", postgres.urlForRole(WEB_APP_ROLE));
  project.provide("adminRoleUrl", postgres.urlForRole(ADMIN_APP_ROLE));

  return async () => {
    await postgres.stop();
  };
}
