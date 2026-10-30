import {
  ADMIN_APP_ROLE,
  ADMIN_AUTH_ROLE,
  APPLICATION_ROLES,
  WEB_APP_ROLE,
} from "@fleetapp/db/tenancy";
import { migrateTestDatabase, startTestPostgres } from "@fleetapp/db/testing";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    adminAuthRoleUrl: string;
    operatorsAdminAppRoleUrl: string;
    /** For adding Operators' cars, as the Operator app does, in the same database. */
    operatorsWebAppRoleUrl: string;
  }
}

/**
 * The Operator tests get a database of their own. They need Admins to exist,
 * and the login tests need the Admin table empty to prove the first-Admin
 * command works, so the two cannot share one while running side by side.
 */
const OPERATORS_TEST_DATABASE = "fleetapp_test_operators";

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Every role the migrations grant to has to exist, not only the one these
  // tests use, or the migration itself fails.
  const postgres = await startTestPostgres(APPLICATION_ROLES, {
    extraDatabases: [OPERATORS_TEST_DATABASE],
  });

  await migrateTestDatabase(postgres.ownerUrl);
  await migrateTestDatabase(postgres.ownerUrlForDatabase(OPERATORS_TEST_DATABASE));

  project.provide("adminAuthRoleUrl", postgres.urlForRole(ADMIN_AUTH_ROLE));
  project.provide(
    "operatorsAdminAppRoleUrl",
    postgres.urlForRoleInDatabase(ADMIN_APP_ROLE, OPERATORS_TEST_DATABASE),
  );

  project.provide(
    "operatorsWebAppRoleUrl",
    postgres.urlForRoleInDatabase(WEB_APP_ROLE, OPERATORS_TEST_DATABASE),
  );

  return async () => {
    await postgres.stop();
  };
}
