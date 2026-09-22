import type { TestProject } from "vitest/node";

import { ADMIN_APP_ROLE, ADMIN_AUTH_ROLE, WEB_APP_ROLE } from "../src/tenancy";
import { migrateTestDatabase, startTestPostgres } from "../src/testing";

declare module "vitest" {
  export interface ProvidedContext {
    webRoleUrl: string;
    adminRoleUrl: string;
    adminAuthRoleUrl: string;
    superuserUrl: string;
    ownerUrl: string;
  }
}

/**
 * Starts one Postgres for the whole run and applies the real migration files
 * to it. The tests then connect as the real application roles, so what they
 * prove about tenant isolation is what production will actually do.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const postgres = await startTestPostgres([WEB_APP_ROLE, ADMIN_APP_ROLE, ADMIN_AUTH_ROLE]);

  await migrateTestDatabase(postgres.ownerUrl);

  project.provide("ownerUrl", postgres.ownerUrl);
  project.provide("superuserUrl", postgres.superuserUrl);
  project.provide("webRoleUrl", postgres.urlForRole(WEB_APP_ROLE));
  project.provide("adminRoleUrl", postgres.urlForRole(ADMIN_APP_ROLE));
  project.provide("adminAuthRoleUrl", postgres.urlForRole(ADMIN_AUTH_ROLE));

  return async () => {
    await postgres.stop();
  };
}
