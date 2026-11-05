import { sql } from "drizzle-orm";
import { z } from "zod";

import { installSafeErrorLogging } from "@fleetapp/core/server";

import type { AnyDatabase } from "./client";

const roleRowSchema = z.object({
  rows: z.array(
    z.object({
      is_superuser: z.boolean(),
      bypasses_rls: z.boolean(),
      owns_tables: z.boolean(),
    }),
  ),
});

/**
 * What would make this connection's database login unsafe for an app
 * (review G1-4): a superuser, a login that skips row-level security, or the
 * tables' owner. Any of them silently removes the second lock that keeps
 * each business's records apart (rule 2). Empty when the login is safe.
 */
export async function databaseRoleProblems(database: AnyDatabase): Promise<string[]> {
  const result = roleRowSchema.parse(
    await database.execute(sql`
      SELECT r.rolsuper AS is_superuser,
        r.rolbypassrls AS bypasses_rls,
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_tables t
          WHERE t.schemaname = 'public' AND t.tableowner = current_user
        ) AS owns_tables
      FROM pg_catalog.pg_roles r
      WHERE r.rolname = current_user
    `),
  );
  const [role] = result.rows;
  if (!role) {
    return ["the database login could not be found"];
  }
  return [
    role.is_superuser ? "it is a superuser" : null,
    role.bypasses_rls ? "it can bypass row-level security (BYPASSRLS)" : null,
    role.owns_tables ? "it owns the app's tables" : null,
  ].filter((problem): problem is string => problem !== null);
}

/**
 * Refuses to start an app whose database login is unsafe: fails loudly at
 * start-up instead of quietly running without the tenant lock. The login's
 * name never appears, only what is wrong with it.
 */
export async function assertSafeDatabaseRole(database: AnyDatabase, which: string): Promise<void> {
  const problems = await databaseRoleProblems(database);
  if (problems.length > 0) {
    throw new Error(
      `The ${which} database login is unsafe: ${problems.join(", ")}. See docs/runbooks/database-roles.md.`,
    );
  }
}

/**
 * What each app does as its server starts: makes server error logging safe
 * (review A7-1), then refuses to start if any of its database logins could
 * skip the tenant lock (review G1-4).
 */
export async function prepareServer(databases: Record<string, AnyDatabase>): Promise<void> {
  installSafeErrorLogging();
  for (const [which, database] of Object.entries(databases)) {
    await assertSafeDatabaseRole(database, which);
  }
}
