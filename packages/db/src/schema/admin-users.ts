import { sql } from "drizzle-orm";
import { boolean, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

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

    // Required by Better Auth. Always true in v1: an Admin's address is
    // verified out of band by AGS before the account is created at all.
    emailVerified: boolean("email_verified").notNull().default(false),

    // Required by Better Auth, unused in v1. AGS staff have no profile photo.
    image: text("image"),

    /** Whether this Admin has finished setting up their authenticator app. */
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),

    ...auditColumns,
  },
  (table) => [uniqueIndex("admin_users_email_unique").on(sql`lower(${table.email})`)],
);
