import { authEnvShape } from "@fleetapp/auth";
import { emailEnvShape } from "@fleetapp/email";
import { z } from "zod";

// Validated once at import time so a missing/invalid variable fails fast
// instead of surfacing as a confusing runtime error later.
const envSchema = z.object({
  ...authEnvShape,
  ...emailEnvShape,

  ADMIN_URL: z.url(),

  /** Connection string for `admin_app_role`: everything except credentials. */
  DATABASE_URL: z.string().min(1),

  /**
   * Connection string for `admin_auth_role`, used only by the login system.
   * Separate on purpose: the rest of the admin app runs on DATABASE_URL, whose
   * role cannot read a password hash or an authenticator secret.
   */
  AUTH_DATABASE_URL: z.string().min(1),

  /** The Operator app's address, to build the links in invite emails. */
  APP_URL: z.url(),
});

export const env = envSchema.parse({
  ADMIN_URL: process.env.ADMIN_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_DATABASE_URL: process.env.AUTH_DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  AUTH_ISSUER_NAME: process.env.AUTH_ISSUER_NAME,
  APP_URL: process.env.APP_URL,
  EMAIL_TRANSPORT: process.env.EMAIL_TRANSPORT,
  EMAIL_FROM: process.env.EMAIL_FROM,
});
