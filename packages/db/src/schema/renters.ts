import {
  LICENCE_CLASSES,
  LICENCE_ISSUERS,
  LICENCE_TYPES,
  MAXIMUM_OVERSEAS_LICENCE_NUMBER_LENGTH,
  RENTER_KINDS,
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
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { auditColumns, primaryKeyColumn, timestampColumns } from "./columns";
import { operatorIdColumn } from "./operators";
import { users } from "./users";

export const renterStatusEnum = pgEnum("renter_status", RENTER_STATUSES);
export const renterKindEnum = pgEnum("renter_kind", RENTER_KINDS);
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

    /**
     * A person, or a business whose cars are driven by person Renters it
     * names (`organisation_drivers`). Fixed at creation: the app's role has
     * no grant to change it, as it would change the meaning of every rental.
     */
    kind: renterKindEnum("kind").notNull().default("person"),
    /** A person's name, or a business's legal name. */
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

    /** A business's trading name, if it has one. */
    tradingName: text("trading_name"),
    /**
     * Digits only, checked with the ATO's checksum. A business's, or a
     * person's own (a sole trader, printed on their invoices). Not unique:
     * two branches can share one.
     */
    abn: text("abn"),
    /** A business's contact (who gets the invoices); `phone` and `email` are theirs. */
    contactName: text("contact_name"),
    businessAddress: text("business_address"),

    status: renterStatusEnum("status").notNull().default("active"),
    /** Private to the Operator. Required for, and only for, "do not rent". */
    doNotRentReason: text("do_not_rent_reason"),
    /**
     * When the nightly job removed this Renter's personal details, seven years
     * after their last rental (review G8-4). Only that job's database function
     * sets it; the app's own role has no grant on it.
     */
    retiredAt: timestamp("retired_at", { withTimezone: true }),

    ...auditColumns,
  },
  (table) => [
    // Lets licence scans and notes point at a Renter *and* its Operator, so
    // nothing can link one Operator's record to another's Renter.
    unique("renters_id_operator_unique").on(table.id, table.operatorId),
    index("renters_operator_name_idx").on(table.operatorId, table.fullName),
    // A retired Renter's details are removed (7 years on): no contact is left by design.
    check(
      "renters_has_contact",
      sql`${table.retiredAt} is not null or num_nonnulls(${table.phone}, ${table.email}) > 0`,
    ),
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
    // A business holds no person's details, so the licence index never sees
    // one; a person holds no business's.
    check(
      "renters_kind_fields",
      sql`(${table.kind} = 'person'
          and num_nonnulls(${table.tradingName}, ${table.contactName}, ${table.businessAddress}) = 0)
        or (${table.kind} = 'organisation'
          and num_nonnulls(${table.dateOfBirth}, ${table.preferredName}, ${table.residentialAddress},
            ${table.emergencyContactName}, ${table.emergencyContactPhone},
            ${table.emergencyContactRelationship}, ${table.licenceIssuedIn}, ${table.licenceCountry},
            ${table.licenceNumber}, ${table.licenceClass}, ${table.licenceType},
            ${table.licenceExpiresOn}) = 0)`,
    ),
    check("renters_abn_shape", sql`${table.abn} is null or ${table.abn} ~ '^[0-9]{11}$'`),
    check("renters_abn_checksum", sql`${table.abn} is null or app.is_valid_abn(${table.abn})`),
    // The contract, invoices and statements go to a business by email (Abhi, 7 Nov 2026).
    check(
      "renters_organisation_email",
      sql`${table.retiredAt} is not null or ${table.kind} <> 'organisation' or ${table.email} is not null`,
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

/**
 * Which people drive for which business Renter (docs/plans/business-renters.md):
 * a driver is a person Renter, so one licence check, one details form and one
 * set of privacy rules covers everyone. A removed driver keeps their row (the
 * history); adding them back is a new row. Never deleted (rule 13). No admin
 * access (rule 5).
 */
export const organisationDrivers = pgTable(
  "organisation_drivers",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    /** The business Renter (kind organisation). */
    organisationId: uuid("organisation_id").notNull(),
    /** The person Renter who drives for it. */
    driverId: uuid("driver_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    addedByUserId: uuid("added_by_user_id")
      .notNull()
      .references(() => users.id),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByUserId: uuid("removed_by_user_id").references(() => users.id),
    ...timestampColumns,
  },
  (table) => [
    foreignKey({
      name: "organisation_drivers_organisation_fk",
      columns: [table.organisationId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    foreignKey({
      name: "organisation_drivers_driver_fk",
      columns: [table.driverId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    uniqueIndex("organisation_drivers_one_current")
      .on(table.operatorId, table.organisationId, table.driverId)
      .where(sql`${table.removedAt} is null`),
    index("organisation_drivers_driver_idx").on(table.operatorId, table.driverId),
    check("organisation_drivers_not_self", sql`${table.organisationId} <> ${table.driverId}`),
    check(
      "organisation_drivers_removed",
      sql`(${table.removedByUserId} is null or ${table.removedAt} is not null)
        and (${table.removedAt} is null or ${table.removedAt} >= ${table.addedAt})`,
    ),
  ],
);
