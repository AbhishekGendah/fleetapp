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

  /** The bucket for logos, car photos and every other general file. Private. */
  STORAGE_BUCKET: z.string().min(1),
  /** The bucket for identity documents only (rule 8). Private. */
  IDENTITY_STORAGE_BUCKET: z.string().min(1),
  /** Where both buckets are: Sydney, `ap-southeast-2`. */
  FILE_STORAGE_REGION: z.string().min(1),
  /**
   * The app's own login to the two buckets and nothing else. Not named
   * AWS_ACCESS_KEY_ID: Vercel sets that name itself on its servers.
   */
  FILE_STORAGE_ACCESS_KEY_ID: z.string().min(1),
  FILE_STORAGE_SECRET_ACCESS_KEY: z.string().min(1),

  /**
   * Proves a scheduled job's call comes from Vercel's scheduler, which sends
   * it as a bearer token. Random, at least 32 characters.
   */
  CRON_SECRET: z.string().min(32, "CRON_SECRET must be at least 32 characters"),
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
  STORAGE_BUCKET: process.env.STORAGE_BUCKET,
  IDENTITY_STORAGE_BUCKET: process.env.IDENTITY_STORAGE_BUCKET,
  FILE_STORAGE_REGION: process.env.FILE_STORAGE_REGION,
  FILE_STORAGE_ACCESS_KEY_ID: process.env.FILE_STORAGE_ACCESS_KEY_ID,
  FILE_STORAGE_SECRET_ACCESS_KEY: process.env.FILE_STORAGE_SECRET_ACCESS_KEY,
  CRON_SECRET: process.env.CRON_SECRET,
});
