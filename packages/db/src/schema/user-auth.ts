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
import { TENANT_ID_COLUMN } from "../tenancy";
import { operators } from "./operators";
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

/**
 * `operator_id` for the login tables, filled in by the database trigger.
 *
 * Better Auth refuses to start if a required column has no default, since it
 * never writes this one itself. Inserting the SQL keyword DEFAULT is what
 * Drizzle does for a missing column anyway; saying so here tells Better Auth
 * the database supplies a value, and the trigger then does.
 */
const triggerFilledOperatorIdColumn = {
  // A fresh builder: $defaultFn changes the builder it is called on, and the
  // shared one is used by every other tenant table.
  operatorId: uuid(TENANT_ID_COLUMN)
    .notNull()
    .references(() => operators.id)
    .$defaultFn(() => sql`DEFAULT`),
} as const;

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
    ...triggerFilledOperatorIdColumn,
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
    ...triggerFilledOperatorIdColumn,
    ...userReference,

    // jscpd:ignore-start -- the Admin and User login tables are kept apart on purpose (separate database roles); Better Auth needs these columns in both
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
    // jscpd:ignore-end

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
    ...triggerFilledOperatorIdColumn,
    ...userReference,

    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified"),
    failedVerificationCount: integer("failed_verification_count"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (table) => [index("user_two_factors_user_id_idx").on(table.userId)],
);

/**
 * Browsers a User has signed in from, for the new-device email. Each holds a
 * long-lived random cookie; only its fingerprint is stored, so the table
 * cannot be used to fake a known device. Nothing else about the device is
 * kept: the email describes it at the moment of sign-in and that is all.
 */
export const userKnownDevices = pgTable(
  "user_known_devices",
  {
    ...primaryKeyColumn,
    ...triggerFilledOperatorIdColumn,
    ...userReference,

    deviceHash: text("device_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("user_known_devices_user_device_unique").on(table.userId, table.deviceHash),
  ],
);
