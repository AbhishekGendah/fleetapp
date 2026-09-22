import { ADMIN_APP_ROLE, ADMIN_AUTH_ROLE, WEB_APP_ROLE } from "@fleetapp/db/tenancy";
import { migrateTestDatabase, startTestPostgres } from "@fleetapp/db/testing";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    adminAuthRoleUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Every role the migrations grant to has to exist, not only the one these
  // tests use, or the migration itself fails.
  const postgres = await startTestPostgres([WEB_APP_ROLE, ADMIN_APP_ROLE, ADMIN_AUTH_ROLE]);

  await migrateTestDatabase(postgres.ownerUrl);

  project.provide("adminAuthRoleUrl", postgres.urlForRole(ADMIN_AUTH_ROLE));

  return async () => {
    await postgres.stop();
  };
}
