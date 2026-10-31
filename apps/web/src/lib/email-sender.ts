import { createEmailSender } from "@fleetapp/email";

import { env } from "../env";
import { appDb } from "./app-db";

/**
 * Emails the Operator app sends outside the login system, such as Renter
 * links and codes. On the app's own connection, which may add to the test
 * inbox and nothing more there.
 */
export const appEmailSender = createEmailSender({
  transport: env.EMAIL_TRANSPORT,
  database: appDb,
  from: env.EMAIL_FROM,
});
