import { RENTER_STATUSES } from "@fleetapp/core";
import { sql } from "drizzle-orm";
import { check, date, index, pgEnum, pgTable, text, unique } from "drizzle-orm/pg-core";

import { auditColumns, primaryKeyColumn } from "./columns";
import { operatorIdColumn } from "./operators";

export const renterStatusEnum = pgEnum("renter_status", RENTER_STATUSES);

/**
 * An Operator's customer (docs/design/03). Personal information: the admin
 * app has no access to this table at all (rule 5), and none of it is written
 * into the activity log, only which detail changed. Never shared between
 * Operators, "do not rent" included. Archived, never deleted (rule 13).
 *
 * Only the name and a phone or email are needed to start a Renter, so one
 * can be added from a phone call; the rest is asked for before renting.
 */
export const renters = pgTable(
  "renters",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,

    fullName: text("full_name").notNull(),
    preferredName: text("preferred_name"),
    /** A date, never a time, so it cannot move a day with timezones. */
    dateOfBirth: date("date_of_birth"),
    /** Tidied by `formatAustralianPhone`. */
    phone: text("phone"),
    /** Lower case, so the same address always matches. */
    email: text("email"),
    residentialAddress: text("residential_address"),
    /** Null means the same as the home address. */
    postalAddress: text("postal_address"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    emergencyContactRelationship: text("emergency_contact_relationship"),

    status: renterStatusEnum("status").notNull().default("active"),
    /** Private to the Operator. Required for, and only for, "do not rent". */
    doNotRentReason: text("do_not_rent_reason"),

    ...auditColumns,
  },
  (table) => [
    // Lets licence scans and notes point at a Renter *and* its Operator, so
    // nothing can link one Operator's record to another's Renter.
    unique("renters_id_operator_unique").on(table.id, table.operatorId),
    index("renters_operator_name_idx").on(table.operatorId, table.fullName),
    check("renters_has_contact", sql`num_nonnulls(${table.phone}, ${table.email}) > 0`),
    check("renters_email_lower_case", sql`${table.email} = lower(${table.email})`),
    check(
      "renters_do_not_rent_reason",
      sql`(${table.status} = 'do_not_rent') = (${table.doNotRentReason} is not null)`,
    ),
  ],
);
