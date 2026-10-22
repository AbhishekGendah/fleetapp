import { integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Wrong-password lockout, on both apps' account tables.
 *
 * Better Auth only rate-limits sign-ins, and keeps the counts in each server's
 * memory: on Vercel that resets constantly and is spread across many servers,
 * so it barely slows a password guesser down. These two columns keep the count
 * in the database instead, per login.
 */
export const signInLockoutColumns = {
  failedSignInCount: integer("failed_sign_in_count").notNull().default(0),
  signInLockedUntil: timestamp("sign_in_locked_until", { withTimezone: true }),
} as const;
