import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { auditColumns, primaryKeyColumn } from "./columns";
import { operatorIdColumn } from "./operators";

/**
 * A User is an Operator's login. Exactly one per Operator in v1, but a
 * separate table so more can be added later without a migration of records.
 *
 * The password hash and authenticator secret live in the login tables in
 * `user-auth.ts`, which only the Operator login system's role can reach.
 */
export const users = pgTable(
  "users",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,

    email: text("email").notNull(),
    fullName: text("full_name").notNull(),

    // Required by Better Auth. Set true when the invite is accepted: the
    // invite email reaching them is what proves the address.
    emailVerified: boolean("email_verified").notNull().default(false),

    // Required by Better Auth, unused in v1.
    image: text("image"),

    /** Whether this User has finished setting up their authenticator app. */
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),

    ...auditColumns,
  },
  (table) => [
    // An email identifies exactly one login across the whole platform, so
    // this is unique globally rather than per Operator. Case-insensitive,
    // because people do not type their own email consistently.
    uniqueIndex("users_email_unique").on(sql`lower(${table.email})`),
    index("users_operator_id_idx").on(table.operatorId),
  ],
);
