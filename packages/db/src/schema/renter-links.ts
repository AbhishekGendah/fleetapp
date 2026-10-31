import { RENTER_LINK_PURPOSES, RENTER_SUBMISSION_STATUSES } from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryKeyColumn, timestampColumns } from "./columns";
import { operatorIdColumn } from "./operators";
import { licenceClassEnum, licenceIssuerEnum, licenceTypeEnum, renters } from "./renters";
import { users } from "./users";

export const renterLinkPurposeEnum = pgEnum("renter_link_purpose", RENTER_LINK_PURPOSES);

/**
 * A link a Renter opens without logging in (rule 26). Only a fingerprint of
 * its secret is kept. It is for one purpose and one Renter, expires, and can
 * be cancelled; sending a new one cancels the old. The one-time code for a
 * new phone is kept the same way, as a fingerprint. No admin access (rule 5).
 */
export const renterLinks = pgTable(
  "renter_links",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    renterId: uuid("renter_id").notNull(),
    purpose: renterLinkPurposeEnum("purpose").notNull(),
    /** SHA-256 of the secret in the address: see `hashSecretToken`. */
    tokenHash: text("token_hash").notNull().unique(),
    /** Where the link and its codes were emailed. */
    sentToEmail: text("sent_to_email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),

    /** The code waiting to be typed, as a fingerprint: see `hashLinkCode`. */
    codeHash: text("code_hash"),
    codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
    /** Wrong tries at the current code. */
    codeTries: integer("code_tries").notNull().default(0),
    /** The hour that codes are being counted in, and how many went out in it. */
    codesWindowStartedAt: timestamp("codes_window_started_at", { withTimezone: true }),
    codesInWindow: integer("codes_in_window").notNull().default(0),
    /** Too many wrong codes: the link stays shut until the Operator sends a new one. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    /** Address searches made from the link's form, capped so a link cannot run up the bill. */
    addressSearches: integer("address_searches").notNull().default(0),

    ...timestampColumns,
  },
  (table) => [
    unique("renter_links_id_operator_unique").on(table.id, table.operatorId),
    foreignKey({
      name: "renter_links_renter_fk",
      columns: [table.renterId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    // One link of each kind in play per Renter: sending another cancels the first.
    uniqueIndex("renter_links_one_live_per_purpose")
      .on(table.operatorId, table.renterId, table.purpose)
      .where(sql`${table.cancelledAt} is null`),
    index("renter_links_renter_idx").on(table.operatorId, table.renterId),
    check(
      "renter_links_code_whole",
      sql`(${table.codeHash} is null) = (${table.codeExpiresAt} is null)`,
    ),
    check("renter_links_counts", sql`${table.codeTries} >= 0 and ${table.codesInWindow} >= 0`),
  ],
);

/**
 * The phones that have typed a right code for a link, so they are not asked
 * again. Each holds a private cookie; only its fingerprint is kept here.
 */
export const renterLinkDevices = pgTable(
  "renter_link_devices",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    linkId: uuid("link_id").notNull(),
    deviceTokenHash: text("device_token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "renter_link_devices_link_fk",
      columns: [table.linkId, table.operatorId],
      foreignColumns: [renterLinks.id, renterLinks.operatorId],
    }),
  ],
);

export const renterSubmissionStatusEnum = pgEnum(
  "renter_submission_status",
  RENTER_SUBMISSION_STATUSES,
);

/**
 * What a Renter sent through their details link. Nothing on the Renter's
 * record changes until the Operator approves it (decision 4 of
 * docs/plans/phase-2-step-4.md). One waiting at a time per Renter. Personal
 * information: no admin access (rule 5).
 */
export const renterSubmissions = pgTable(
  "renter_submissions",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    renterId: uuid("renter_id").notNull(),
    linkId: uuid("link_id").notNull(),
    status: renterSubmissionStatusEnum("status").notNull().default("waiting"),

    fullName: text("full_name").notNull(),
    preferredName: text("preferred_name"),
    dateOfBirth: date("date_of_birth").notNull(),
    phone: text("phone"),
    email: text("email"),
    residentialAddress: text("residential_address").notNull(),
    postalAddress: text("postal_address"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    emergencyContactRelationship: text("emergency_contact_relationship"),

    licenceIssuedIn: licenceIssuerEnum("licence_issued_in").notNull(),
    licenceCountry: text("licence_country"),
    licenceNumber: text("licence_number").notNull(),
    licenceClass: licenceClassEnum("licence_class").notNull(),
    licenceType: licenceTypeEnum("licence_type").notNull(),
    licenceExpiresOn: date("licence_expires_on").notNull(),

    /** The Operator's note when sending it back. */
    reviewNote: text("review_note"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    ...timestampColumns,
  },
  (table) => [
    unique("renter_submissions_id_operator_unique").on(table.id, table.operatorId),
    foreignKey({
      name: "renter_submissions_renter_fk",
      columns: [table.renterId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    foreignKey({
      name: "renter_submissions_link_fk",
      columns: [table.linkId, table.operatorId],
      foreignColumns: [renterLinks.id, renterLinks.operatorId],
    }),
    uniqueIndex("renter_submissions_one_waiting_per_renter")
      .on(table.operatorId, table.renterId)
      .where(sql`${table.status} = 'waiting'`),
    check("renter_submissions_has_contact", sql`num_nonnulls(${table.phone}, ${table.email}) > 0`),
    check(
      "renter_submissions_reviewed",
      sql`(${table.status} = 'waiting') = (${table.reviewedAt} is null)`,
    ),
  ],
);
