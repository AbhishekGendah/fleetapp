import { createBreachedPasswordCheck } from "@fleetapp/auth";
import { createDb } from "@fleetapp/db/client";
import { createEmailSender } from "@fleetapp/email";
import { nextCookies } from "better-auth/next-js";

import { env } from "../env";
import { createUserAuth } from "./auth-options";

/**
 * The Operator login system, on its own connection (`AUTH_DATABASE_URL`),
 * whose role can reach the credential tables. The rest of the app runs on
 * `DATABASE_URL`, whose role cannot.
 */
export const authDb = createDb(env.AUTH_DATABASE_URL);

export const auth = createUserAuth({
  database: authDb,
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  issuerName: env.AUTH_ISSUER_NAME,
  // On the login role's connection: it may add to the test inbox, nothing more.
  emailSender: createEmailSender({
    transport: env.EMAIL_TRANSPORT,
    database: authDb,
    from: env.EMAIL_FROM,
  }),
  isPasswordBreached: createBreachedPasswordCheck(),
  // Lets server actions (accepting an invite) set the sign-in cookie.
  extraPlugins: [nextCookies()],
});
