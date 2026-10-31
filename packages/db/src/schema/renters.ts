import {
  LICENCE_CLASSES,
  LICENCE_ISSUERS,
  LICENCE_TYPES,
  MAXIMUM_OVERSEAS_LICENCE_NUMBER_LENGTH,
  RENTER_STATUSES,
} from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { auditColumns, primaryKeyColumn } from "./columns";
import { operatorIdColumn } from "./operators";
import { users } from "./users";

export const renterStatusEnum = pgEnum("renter_status", RENTER_STATUSES);
export const licenceIssuerEnum = pgEnum("licence_issuer", LICENCE_ISSUERS);
export const licenceClassEnum = pgEnum("licence_class", LICENCE_CLASSES);
export const licenceTypeEnum = pgEnum("licence_type", LICENCE_TYPES);

/** Named so the app can tell a licence already on file from any other failure. */
export const RENTER_LICENCE_UNIQUE_INDEX = "renters_one_licence_per_operator";

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

    /**
     * The current licence (one per Renter: a renewal is an edit). All of it
     * or none. Never written into the log (rule 7).
     */
    licenceIssuedIn: licenceIssuerEnum("licence_issued_in"),
    /** ISO code, only for an overseas licence. */
    licenceCountry: text("licence_country"),
    /** Capitals and digits only: see `normaliseLicenceNumber`. */
    licenceNumber: text("licence_number"),
    licenceClass: licenceClassEnum("licence_class"),
    licenceType: licenceTypeEnum("licence_type"),
    licenceExpiresOn: date("licence_expires_on"),

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
    // One Renter per licence, archived ones included, so a returning Renter
    // is brought back rather than entered twice.
    uniqueIndex(RENTER_LICENCE_UNIQUE_INDEX)
      .on(
        table.operatorId,
        table.licenceIssuedIn,
        sql`coalesce(${table.licenceCountry}, '')`,
        table.licenceNumber,
      )
      .where(sql`${table.licenceNumber} is not null`),
    check(
      "renters_licence_complete",
      sql`num_nonnulls(${table.licenceIssuedIn}, ${table.licenceNumber}, ${table.licenceClass}, ${table.licenceType}, ${table.licenceExpiresOn}) in (0, 5)
        and (${table.licenceCountry} is not null) = coalesce(${table.licenceIssuedIn}::text = 'overseas', false)
        and ${table.licenceNumber} ~ ${sql.raw(`'^[A-Z0-9]{1,${MAXIMUM_OVERSEAS_LICENCE_NUMBER_LENGTH}}$'`)}`,
    ),
    check(
      "renters_do_not_rent_reason",
      sql`(${table.status} = 'do_not_rent') = (${table.doNotRentReason} is not null)`,
    ),
  ],
);

/**
 * Dated notes the Operator keeps about a Renter. Never edited: one written by
 * mistake is archived and stays in the Log. The Renter can ask to see them
 * (APP 12), so the screen asks for facts only. No admin access (rule 5).
 */
export const renterNotes = pgTable(
  "renter_notes",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    renterId: uuid("renter_id").notNull(),
    body: text("body").notNull(),
    writtenByUserId: uuid("written_by_user_id")
      .notNull()
      .references(() => users.id),
    ...auditColumns,
  },
  (table) => [
    foreignKey({
      name: "renter_notes_renter_fk",
      columns: [table.renterId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    index("renter_notes_renter_idx").on(table.operatorId, table.renterId, table.createdAt),
    check("renter_notes_body_not_blank", sql`length(trim(${table.body})) > 0`),
  ],
);
