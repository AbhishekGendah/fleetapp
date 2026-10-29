import { hashSecretToken, isInviteUsable, operatorDisplayName } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { operatorInvites, operators, users } from "@fleetapp/db/schema";
import { eq } from "drizzle-orm";

export interface UsableInvite {
  inviteId: string;
  userId: string;
  operatorId: string;
  email: string;
  operatorName: string;
}

/**
 * The invite behind a link, if it can still be used. Null for every reason it
 * cannot (no such link, expired, cancelled, used, User archived, Operator
 * suspended or archived), so the page shows the same thing whatever the
 * reason and a link reveals nothing about why.
 *
 * Runs on `web_auth_role`: nobody is signed in yet, so there is no Operator to
 * scope the lookup by. It finds the invite by the link's fingerprint only.
 */
export async function findUsableInvite(
  database: AnyDatabase,
  token: string,
  now: Date,
): Promise<UsableInvite | null> {
  const [row] = await database
    .select({
      invite: operatorInvites,
      email: users.email,
      userArchivedAt: users.archivedAt,
      legalName: operators.legalName,
      tradingName: operators.tradingName,
      suspendedAt: operators.suspendedAt,
      operatorArchivedAt: operators.archivedAt,
    })
    .from(operatorInvites)
    .innerJoin(users, eq(users.id, operatorInvites.userId))
    .innerJoin(operators, eq(operators.id, operatorInvites.operatorId))
    .where(eq(operatorInvites.tokenHash, hashSecretToken(token)));

  if (!row || !isInviteUsable(row.invite, now)) {
    return null;
  }
  if (row.userArchivedAt || row.suspendedAt || row.operatorArchivedAt) {
    return null;
  }

  return {
    inviteId: row.invite.id,
    userId: row.invite.userId,
    operatorId: row.invite.operatorId,
    email: row.email,
    operatorName: operatorDisplayName(row),
  };
}
