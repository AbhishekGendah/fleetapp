import { boolean, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * What Better Auth keeps for an authenticator, the same for Users and
 * Admins, plus the last code accepted (review A2-7, A2-9).
 */
export const twoFactorColumns = {
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: boolean("verified"),
  failedVerificationCount: integer("failed_verification_count"),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  /** A fingerprint of the last authenticator code accepted, so it can't be used again (review A2-7). */
  lastCodeHash: text("last_code_hash"),
  /** When a code was last typed: a remembered device lasts 14 days from it, not from each sign-in (review A2-9). */
  lastCodeAt: timestamp("last_code_at", { withTimezone: true }),
} as const;
