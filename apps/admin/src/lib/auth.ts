import { createDb } from "@fleetapp/db/client";
import { adminActivityLog } from "@fleetapp/db/schema";

import { env } from "../env";
import { createAdminAuth } from "./auth-options";

/**
 * The Admin login system.
 *
 * It runs on its own database connection, `AUTH_DATABASE_URL`, whose role can
 * reach the Admin credential tables. The rest of the admin app runs on
 * `DATABASE_URL`, whose role cannot. That separation is the point: a bug in an
 * Operator list or a report has no connection on which a password hash is
 * readable.
 */
const authDb = createDb(env.AUTH_DATABASE_URL);

export const auth = createAdminAuth({
  database: authDb,
  baseURL: env.ADMIN_URL,
  secret: env.BETTER_AUTH_SECRET,
  issuerName: env.AUTH_ISSUER_NAME,
  recordActivity: async (entry) => {
    try {
      await authDb.insert(adminActivityLog).values({
        adminUserId: entry.adminUserId ?? null,
        action: entry.action,
        ipAddress: entry.ipAddress ?? null,
      });
    } catch (error) {
      // Failing to write an audit line must not be what stops someone
      // signing in. Logs the failure, never the entry: the entry names an
      // Admin and this goes to the hosting provider's logs.
      console.error("Failed to write to the Admin activity log", error);
    }
  },
});
