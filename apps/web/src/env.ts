// Secrets live here: a browser bundle that imports this fails the build.
import "server-only";

import { authEnvShape } from "@fleetapp/auth";
import { PAYMENTS_TRANSPORTS } from "@fleetapp/core";
import { emailEnvShape, refuseTestInboxInProduction } from "@fleetapp/email";
import { z } from "zod";

/**
 * Stripe needs both its secrets; the stand-in needs the events secret to
 * sign with; and production never runs on the stand-in (decision 6).
 */
function requireStripeSettings(
  env: {
    PAYMENTS_TRANSPORT: string;
    STRIPE_SECRET_KEY?: string | undefined;
    STRIPE_WEBHOOK_SECRET?: string | undefined;
    APP_STAGE?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  const isStripe = env.PAYMENTS_TRANSPORT === "stripe";
  if (isStripe && !env.STRIPE_SECRET_KEY) {
    context.addIssue({
      code: "custom",
      path: ["STRIPE_SECRET_KEY"],
      message: "PAYMENTS_TRANSPORT=stripe needs STRIPE_SECRET_KEY.",
    });
  }
  if (env.PAYMENTS_TRANSPORT !== "off" && !env.STRIPE_WEBHOOK_SECRET) {
    context.addIssue({
      code: "custom",
      path: ["STRIPE_WEBHOOK_SECRET"],
      message: "Taking Stripe's events needs STRIPE_WEBHOOK_SECRET.",
    });
  }
  if (env.APP_STAGE === "production" && env.PAYMENTS_TRANSPORT === "stand_in") {
    context.addIssue({
      code: "custom",
      path: ["PAYMENTS_TRANSPORT"],
      message: "PAYMENTS_TRANSPORT=stand_in must never be used in production.",
    });
  }
}

// Validated once at import time so a missing/invalid variable fails fast
// instead of surfacing as a confusing runtime error later.
const envSchema = z
  .object({
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
    /** Google Places (New): https://places.googleapis.com. A stand-in in browser tests. */
    GOOGLE_PLACES_API_URL: z.url(),

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
    /** Only for the browser tests' local S3 stand-in. Never set on Vercel: Amazon is used. */
    FILE_STORAGE_ENDPOINT: z.url().optional(),

    /**
     * Proves a scheduled job's call comes from Vercel's scheduler, which sends
     * it as a bearer token. Random, at least 32 characters.
     */
    CRON_SECRET: z.string().min(32, "CRON_SECRET must be at least 32 characters"),

    /**
     * How the app reaches Stripe: "off" until the AGS Stripe account is set
     * up (payments by Stripe are simply not offered), "stand_in" for the
     * browser tests only, "stripe" for real.
     */
    PAYMENTS_TRANSPORT: z.enum(PAYMENTS_TRANSPORTS).default("off"),
    /** The AGS platform account's secret key. Server only, never NEXT_PUBLIC_ (rule 6). */
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    /** Proves an event came from Stripe, for the one events endpoint. */
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  })
  .superRefine(refuseTestInboxInProduction)
  .superRefine(requireStripeSettings);

export const env = envSchema.parse({
  APP_URL: process.env.APP_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_DATABASE_URL: process.env.AUTH_DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  AUTH_ISSUER_NAME: process.env.AUTH_ISSUER_NAME,
  EMAIL_TRANSPORT: process.env.EMAIL_TRANSPORT,
  EMAIL_FROM: process.env.EMAIL_FROM,
  APP_STAGE: process.env.APP_STAGE,
  GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
  GOOGLE_PLACES_API_URL: process.env.GOOGLE_PLACES_API_URL,
  STORAGE_BUCKET: process.env.STORAGE_BUCKET,
  IDENTITY_STORAGE_BUCKET: process.env.IDENTITY_STORAGE_BUCKET,
  FILE_STORAGE_REGION: process.env.FILE_STORAGE_REGION,
  FILE_STORAGE_ACCESS_KEY_ID: process.env.FILE_STORAGE_ACCESS_KEY_ID,
  FILE_STORAGE_SECRET_ACCESS_KEY: process.env.FILE_STORAGE_SECRET_ACCESS_KEY,
  FILE_STORAGE_ENDPOINT: process.env.FILE_STORAGE_ENDPOINT,
  CRON_SECRET: process.env.CRON_SECRET,
  PAYMENTS_TRANSPORT: process.env.PAYMENTS_TRANSPORT,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
});
