import { adminUsers } from "@fleetapp/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { appDb } from "./app-db";
import { auth } from "./auth";
import { SET_UP_AUTHENTICATOR_PATH, SIGN_IN_PATH } from "./paths";

export interface SignedInAdmin {
  id: string;
  email: string;
  fullName: string;
  twoFactorEnabled: boolean;
}

/**
 * Loads the signed-in Admin, or sends them wherever they need to go first.
 *
 * Every page in the admin app goes through here. Authorisation belongs in
 * server code, not in routing (rule 4), and putting it in one place is what
 * stops a page added in six months quietly forgetting it.
 *
 * `twoFactorEnabled` is read from the database rather than taken from the
 * session: the session is a snapshot from sign-in time, and this decides
 * whether someone gets in at all.
 *
 * Runs on DATABASE_URL, the ordinary app role — which can read an Admin's name
 * and whether they have enrolled, and nothing about their credentials.
 */
export async function requireAdmin(
  options: { allowWithoutAuthenticator?: boolean } = {},
): Promise<SignedInAdmin> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect(SIGN_IN_PATH);
  }

  const [admin] = await appDb
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      fullName: adminUsers.fullName,
      twoFactorEnabled: adminUsers.twoFactorEnabled,
      archivedAt: adminUsers.archivedAt,
    })
    .from(adminUsers)
    .where(eq(adminUsers.id, session.user.id));

  // The record is gone or archived but a session survives it.
  if (!admin || admin.archivedAt) {
    redirect(SIGN_IN_PATH);
  }

  // An Admin reaches every Operator, so there is no using the admin app
  // without an authenticator app set up first.
  if (!admin.twoFactorEnabled && !options.allowWithoutAuthenticator) {
    redirect(SET_UP_AUTHENTICATOR_PATH);
  }

  return {
    id: admin.id,
    email: admin.email,
    fullName: admin.fullName,
    twoFactorEnabled: admin.twoFactorEnabled,
  };
}
