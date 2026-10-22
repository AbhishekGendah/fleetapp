import { createDb } from "@fleetapp/db/client";

import { env } from "../env";

/**
 * The Operator app's database connection, on `web_app_role`. Every query on it
 * runs inside `withTenant()`, scoped to the signed-in User's Operator.
 */
export const appDb = createDb(env.DATABASE_URL);
