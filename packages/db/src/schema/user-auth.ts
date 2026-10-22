import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryKeyColumn } from "./columns";
import { operatorIdColumn } from "./operators";
import { signInLockoutColumns } from "./sign-in-lockout";
import { users } from "./users";

/**
 * The Operator login tables: the same shape as the Admin ones in
 * `admin-auth.ts`, for Users.
 *
 * Reachable only by `web_auth_role`. The role the rest of the Operator app
 * runs as is granted nothing on them.
 *
 * Every table that belongs to a User carries `operator_id`, as rule 1 requires
 * of tenant-owned data. Better Auth knows nothing of Operators and never sets
 * it, so a database trigger copies it from the User on every insert.
 */

const userReference = {
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
} as const;

const createdAtColumn = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
} as const;

/** A signed-in User's session. Transient: deleted on sign-out and on expiry. */
export const userSessions = pgTable(
  "user_sessions",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    ...userReference,

    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    ...createdAtColumn,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("user_sessions_token_unique").on(table.token),
    index("user_sessions_user_id_idx").on(table.userId),
  ],
);

/**
 * How a User proves who they are: one row, `providerId` "credential", the
 * password hash in `password`. Created when the invite is accepted.
 */
export const userAccounts = pgTable(
  "user_accounts",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    ...userReference,

    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    password: text("password"),

    // Never populated (no social sign-in) but expected by Better Auth.
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),

    ...signInLockoutColumns,

    ...createdAtColumn,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("user_accounts_user_id_idx").on(table.userId),
    // One password per User. Also what makes accepting an invite twice fail.
    uniqueIndex("user_accounts_user_provider_unique").on(table.userId, table.providerId),
  ],
);

/**
 * Password-reset tokens, stored as fingerprints only. Not tenant-owned: a
 * token is a short-lived secret, not a record of anything, and Better Auth
 * writes it before it is tied to any Operator.
 */
export const userVerifications = pgTable(
  "user_verifications",
  {
    ...primaryKeyColumn,

    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    ...createdAtColumn,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("user_verifications_identifier_idx").on(table.identifier)],
);

/**
 * A User's authenticator app enrolment. `secret` and `backupCodes` arrive
 * encrypted with the Operator app's BETTER_AUTH_SECRET.
 */
export const userTwoFactors = pgTable(
  "user_two_factors",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    ...userReference,

    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified"),
    failedVerificationCount: integer("failed_verification_count"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (table) => [index("user_two_factors_user_id_idx").on(table.userId)],
);
