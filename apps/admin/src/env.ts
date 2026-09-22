import { z } from "zod";

// Validated once at import time so a missing/invalid variable fails fast
// instead of surfacing as a confusing runtime error later.
const envSchema = z.object({
  ADMIN_URL: z.string().url(),

  /** Connection string for `admin_app_role`: everything except credentials. */
  DATABASE_URL: z.string().min(1),

  /**
   * Connection string for `admin_auth_role`, used only by the login system.
   * Separate on purpose: the rest of the admin app runs on DATABASE_URL, whose
   * role cannot read a password hash or an authenticator secret.
   */
  AUTH_DATABASE_URL: z.string().min(1),

  /**
   * Encrypts authenticator secrets and recovery codes, and signs session
   * tokens. If this value is lost or changed, every Admin has to enrol their
   * authenticator app again.
   */
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),

  /**
   * The name shown against the entry in an Admin's authenticator app. An env
   * var rather than a constant because the product name is not settled, and
   * nothing in this codebase hardcodes a brand.
   */
  AUTH_ISSUER_NAME: z.string().min(1),
});

export const env = envSchema.parse({
  ADMIN_URL: process.env.ADMIN_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_DATABASE_URL: process.env.AUTH_DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  AUTH_ISSUER_NAME: process.env.AUTH_ISSUER_NAME,
});
