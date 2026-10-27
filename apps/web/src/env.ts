import { EMAIL_TRANSPORTS } from "@fleetapp/email";
import { z } from "zod";

// Validated once at import time so a missing/invalid variable fails fast
// instead of surfacing as a confusing runtime error later.
const envSchema = z.object({
  APP_URL: z.string().url(),

  /** Connection string for `web_app_role`: everything except credentials. */
  DATABASE_URL: z.string().min(1),

  /**
   * Connection string for `web_auth_role`, used only by the login system.
   * Separate on purpose: the rest of the Operator app runs on DATABASE_URL,
   * whose role cannot read a password hash or an authenticator secret.
   */
  AUTH_DATABASE_URL: z.string().min(1),

  /**
   * Encrypts authenticator secrets and recovery codes, and signs session
   * tokens. If this value is lost or changed, every User has to enrol their
   * authenticator app again. Different from the admin app's.
   */
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),

  /** The name shown against the entry in a User's authenticator app. */
  AUTH_ISSUER_NAME: z.string().min(1),

  /**
   * How email is sent. `dev_outbox` keeps every email in the test inbox on the
   * admin site instead of sending it, and must never be used in production.
   */
  EMAIL_TRANSPORT: z.enum(EMAIL_TRANSPORTS),

  /** Sender name and address, e.g. `Name <no-reply@example.com>`. */
  EMAIL_FROM: z.string().min(1),
});

export const env = envSchema.parse({
  APP_URL: process.env.APP_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_DATABASE_URL: process.env.AUTH_DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  AUTH_ISSUER_NAME: process.env.AUTH_ISSUER_NAME,
  EMAIL_TRANSPORT: process.env.EMAIL_TRANSPORT,
  EMAIL_FROM: process.env.EMAIL_FROM,
});
