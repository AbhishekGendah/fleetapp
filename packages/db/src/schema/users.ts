import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { auditColumns, primaryKeyColumn } from "./columns";
import { operatorIdColumn } from "./operators";

/**
 * A User is an Operator's login. Exactly one per Operator in v1, but a
 * separate table so more can be added later without a migration of records.
 *
 * Credential columns (password hash, TOTP secret, recovery codes) are added by
 * Better Auth in a later slice; this table carries only the identity and the
 * Operator link.
 */
export const users = pgTable(
  "users",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,

    email: text("email").notNull(),
    fullName: text("full_name").notNull(),

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
