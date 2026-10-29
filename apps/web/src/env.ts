import { authEnvShape } from "@fleetapp/auth";
import { emailEnvShape } from "@fleetapp/email";
import { z } from "zod";

// Validated once at import time so a missing/invalid variable fails fast
// instead of surfacing as a confusing runtime error later.
const envSchema = z.object({
  ...authEnvShape,
  ...emailEnvShape,

  APP_URL: z.url(),

  /** Connection string for `web_app_role`: everything except credentials. */
  DATABASE_URL: z.string().min(1),

  /**
   * Connection string for `web_auth_role`, used only by the login system.
   * Separate on purpose: the rest of the Operator app runs on DATABASE_URL,
   * whose role cannot read a password hash or an authenticator secret.
   */
  AUTH_DATABASE_URL: z.string().min(1),

  /**
   * Google Places (New) key for address lookup. Server only: it never reaches
   * the browser. Restricted in Google Cloud to Places API (New), with daily
   * caps set there.
   */
  GOOGLE_PLACES_API_KEY: z.string().min(1),
});

export const env = envSchema.parse({
  APP_URL: process.env.APP_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_DATABASE_URL: process.env.AUTH_DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  AUTH_ISSUER_NAME: process.env.AUTH_ISSUER_NAME,
  EMAIL_TRANSPORT: process.env.EMAIL_TRANSPORT,
  EMAIL_FROM: process.env.EMAIL_FROM,
  GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
});
