import { sql } from "drizzle-orm";
import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { auditColumns, primaryKeyColumn } from "./columns";

/**
 * AGS platform staff. Deliberately not tenant-owned: an Admin belongs to AGS,
 * not to an Operator, so this table has no `operator_id` and is excluded from
 * the tenancy checks by name in `NON_TENANT_TABLES`.
 *
 * apps/web's database role is granted nothing on this table at all.
 */
export const adminUsers = pgTable(
  "admin_users",
  {
    ...primaryKeyColumn,

    email: text("email").notNull(),
    fullName: text("full_name").notNull(),

    ...auditColumns,
  },
  (table) => [uniqueIndex("admin_users_email_unique").on(sql`lower(${table.email})`)],
);
