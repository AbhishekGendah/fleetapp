import {
  hasReachedSessionLimit,
  timeLimitSignInPath,
  USER_SESSION,
} from "@fleetapp/auth/login-policy";
import { getAccountAccess, operatorDisplayName, type AccountAccess } from "@fleetapp/core";
import { operators, users } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { appDb } from "./app-db";
import { auth } from "./auth";
import { HOME_PATH, SET_UP_AUTHENTICATOR_PATH, SIGN_IN_PATH, SUSPENDED_PATH } from "./paths";

export interface SignedInUser {
  id: string;
  operatorId: string;
  email: string;
  fullName: string;
  operatorName: string;
  /** Every time is shown in this zone (rule 10). */
  operatorTimezone: string;
  /** From business details: whether costs can have GST to claim back. */
  isGstRegistered: boolean;
  twoFactorEnabled: boolean;
}

interface SignedInAccount {
  userId: string;
  operatorId: string;
  email: string;
  fullName: string;
  twoFactorEnabled: boolean;
  operatorName: string;
  operatorTimezone: string;
  isGstRegistered: boolean;
  access: AccountAccess;
}

/**
 * The signed-in User and the flags that decide where they may go, or null if
 * nobody is signed in.
 *
 * The Operator comes from the session, which the login system read from the
 * User's own record: never from anything the browser sends (rule 1). The rest
 * is then read through the app's own role, scoped to that Operator, so the
 * flags are current rather than a snapshot from sign-in.
 */
async function loadSignedInAccount(): Promise<SignedInAccount | null> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    return null;
  }
  // Ended for good, not just hidden, so the old cookie is worth nothing.
  if (hasReachedSessionLimit(session.session.createdAt, new Date(), USER_SESSION.maxAgeSeconds)) {
    await auth.api.revokeSession({
      body: { token: session.session.token },
      headers: requestHeaders,
    });
    redirect(timeLimitSignInPath(SIGN_IN_PATH));
  }
  const operatorId = session.user.operatorId;

  const [row] = await withTenant(appDb, operatorId, (tx) =>
    tx
      .select({
        email: users.email,
        fullName: users.fullName,
        twoFactorEnabled: users.twoFactorEnabled,
        userArchivedAt: users.archivedAt,
        legalName: operators.legalName,
        tradingName: operators.tradingName,
        operatorTimezone: operators.timezone,
        isGstRegistered: operators.gstRegistered,
        operatorSuspendedAt: operators.suspendedAt,
        operatorArchivedAt: operators.archivedAt,
      })
      .from(users)
      .innerJoin(operators, eq(operators.id, users.operatorId))
      .where(eq(users.id, session.user.id)),
  );
  if (!row) {
    return null;
  }

  return {
    userId: session.user.id,
    operatorId,
    email: row.email,
    fullName: row.fullName,
    twoFactorEnabled: row.twoFactorEnabled,
    operatorName: operatorDisplayName(row),
    operatorTimezone: row.operatorTimezone,
    isGstRegistered: row.isGstRegistered,
    access: getAccountAccess(row),
  };
}

/**
 * Loads the signed-in User, or sends them wherever they need to go first.
 *
 * Every page in the Operator app goes through here: authorisation belongs in
 * server code, not in routing (rule 4). It runs on every request, so a
 * suspension takes effect at a User's next click, not their next sign-in.
 */
export async function requireUser(
  options: { allowWithoutAuthenticator?: boolean } = {},
): Promise<SignedInUser> {
  const account = await loadSignedInAccount();
  if (!account || account.access === "closed") {
    redirect(SIGN_IN_PATH);
  }
  if (account.access === "suspended") {
    redirect(SUSPENDED_PATH);
  }
  if (!account.twoFactorEnabled && !options.allowWithoutAuthenticator) {
    redirect(SET_UP_AUTHENTICATOR_PATH);
  }

  return {
    id: account.userId,
    operatorId: account.operatorId,
    email: account.email,
    fullName: account.fullName,
    operatorName: account.operatorName,
    operatorTimezone: account.operatorTimezone,
    isGstRegistered: account.isGstRegistered,
    twoFactorEnabled: account.twoFactorEnabled,
  };
}

/**
 * For the suspended page only: lets a suspended Operator's User see it, and
 * sends everyone else on. Checked on every load, so once AGS reactivates the
 * Operator, a refresh takes the User straight back in.
 */
export async function requireSuspendedUser(): Promise<void> {
  const account = await loadSignedInAccount();
  if (!account || account.access === "closed") {
    redirect(SIGN_IN_PATH);
  }
  if (account.access !== "suspended") {
    redirect(HOME_PATH);
  }
}
