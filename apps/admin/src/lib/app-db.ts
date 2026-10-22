import { createDb } from "@fleetapp/db/client";

import { env } from "../env";

/**
 * The admin app's database connection, on `admin_app_role`: everything except
 * Admin credentials, which only the login system's own connection can reach.
 */
export const appDb = createDb(env.DATABASE_URL);
