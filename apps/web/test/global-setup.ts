import {
  ADMIN_APP_ROLE,
  ADMIN_AUTH_ROLE,
  APPLICATION_ROLES,
  WEB_APP_ROLE,
  WEB_AUTH_ROLE,
} from "@fleetapp/db/tenancy";
import { migrateTestDatabase, startTestPostgres } from "@fleetapp/db/testing";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    adminAppRoleUrl: string;
    adminAuthRoleUrl: string;
    webAppRoleUrl: string;
    webAuthRoleUrl: string;
    superuserUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const postgres = await startTestPostgres(APPLICATION_ROLES);

  await migrateTestDatabase(postgres.ownerUrl);

  // The admin role seeds Operators, Users and invites, as the admin app does.
  project.provide("adminAppRoleUrl", postgres.urlForRole(ADMIN_APP_ROLE));
  // AGS staff rows are made on the admin login's connection, as the first-admin command does.
  project.provide("adminAuthRoleUrl", postgres.urlForRole(ADMIN_AUTH_ROLE));
  project.provide("webAppRoleUrl", postgres.urlForRole(WEB_APP_ROLE));
  project.provide("webAuthRoleUrl", postgres.urlForRole(WEB_AUTH_ROLE));
  // Only for a test that must date records years back, which no app role (and,
  // under forced row security, not even the owner) can do.
  project.provide("superuserUrl", postgres.superuserUrl);

  return async () => {
    await postgres.stop();
  };
}
