import {
  ADMIN_APP_ROLE,
  APPLICATION_ROLES,
  WEB_APP_ROLE,
  WEB_AUTH_ROLE,
} from "@fleetapp/db/tenancy";
import { migrateTestDatabase, startTestPostgres } from "@fleetapp/db/testing";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    adminAppRoleUrl: string;
    webAppRoleUrl: string;
    webAuthRoleUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const postgres = await startTestPostgres(APPLICATION_ROLES);

  await migrateTestDatabase(postgres.ownerUrl);

  // The admin role seeds Operators, Users and invites, as the admin app does.
  project.provide("adminAppRoleUrl", postgres.urlForRole(ADMIN_APP_ROLE));
  project.provide("webAppRoleUrl", postgres.urlForRole(WEB_APP_ROLE));
  project.provide("webAuthRoleUrl", postgres.urlForRole(WEB_AUTH_ROLE));

  return async () => {
    await postgres.stop();
  };
}
