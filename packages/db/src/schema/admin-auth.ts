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
import { adminUsers } from "./admin-users";

/**
 * The Admin login tables.
 *
 * Column names and types follow what Better Auth's own schema generator
 * produces, renamed to this codebase's snake_case through the `fields` mapping
 * in the auth config. Changing a name here means changing it there too.
 *
 * All of these are reachable only by `admin_auth_role`. The role the rest of
 * the admin app runs as is granted nothing on them, so a bug in an Operator
 * list or a report cannot read a password hash.
 */

const adminUserReference = {
  adminUserId: uuid("admin_user_id")
    .notNull()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
} as const;

/** A signed-in Admin's session. Transient: deleted on sign-out and on expiry. */
export const adminSessions = pgTable(
  "admin_sessions",
  {
    ...primaryKeyColumn,
    ...adminUserReference,

    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("admin_sessions_token_unique").on(table.token),
    index("admin_sessions_admin_user_id_idx").on(table.adminUserId),
  ],
);

/**
 * How an Admin proves who they are. In v1 there is exactly one row per Admin,
 * with `providerId` "credential" and the password hash in `password`.
 *
 * The social-login columns are never populated — the admin app has no social
 * sign-in — but Better Auth expects them to exist.
 */
export const adminAccounts = pgTable(
  "admin_accounts",
  {
    ...primaryKeyColumn,
    ...adminUserReference,

    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    password: text("password"),

    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("admin_accounts_admin_user_id_idx").on(table.adminUserId)],
);

/** Short-lived tokens behind password reset links. Deleted once used. */
export const adminVerifications = pgTable(
  "admin_verifications",
  {
    ...primaryKeyColumn,

    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("admin_verifications_identifier_idx").on(table.identifier)],
);

/**
 * An Admin's authenticator app enrolment.
 *
 * `secret` and `backupCodes` arrive already encrypted by Better Auth, using
 * BETTER_AUTH_SECRET. Losing that value makes every row here useless and every
 * Admin has to enrol again.
 */
export const adminTwoFactors = pgTable(
  "admin_two_factors",
  {
    ...primaryKeyColumn,
    ...adminUserReference,

    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified"),
    failedVerificationCount: integer("failed_verification_count"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (table) => [index("admin_two_factors_admin_user_id_idx").on(table.adminUserId)],
);
