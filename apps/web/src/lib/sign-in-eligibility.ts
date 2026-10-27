import type { AnyDatabase } from "@fleetapp/db/client";
import { operators, users } from "@fleetapp/db/schema";
import { eq } from "drizzle-orm";

/**
 * Whether a User may have a session at all: not archived, and their Operator
 * neither suspended nor archived. Checked when any session is created, so it
 * covers signing in, the authenticator step and accepting an invite alike.
 */
export async function isAllowedToSignIn(database: AnyDatabase, userId: string): Promise<boolean> {
  const [row] = await database
    .select({
      userArchivedAt: users.archivedAt,
      operatorSuspendedAt: operators.suspendedAt,
      operatorArchivedAt: operators.archivedAt,
    })
    .from(users)
    .innerJoin(operators, eq(operators.id, users.operatorId))
    .where(eq(users.id, userId));

  return Boolean(row && !row.userArchivedAt && !row.operatorSuspendedAt && !row.operatorArchivedAt);
}
