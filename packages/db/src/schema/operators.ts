import { boolean, date, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";

import { auditColumns, primaryKeyColumn } from "./columns";
import { australianStateEnum, subscriptionStatusEnum } from "./enums";

/** An ABN is always 11 digits. Stored without spaces. */
export const ABN_LENGTH = 11;

/** Australian postcodes are always 4 digits. */
export const POSTCODE_LENGTH = 4;

/**
 * The default is the Operator's own timezone, not the server's. Overridden
 * during setup; AGS is in Perth, so that is the least surprising starting
 * point for the first Operators. See rule 10 in CLAUDE.md.
 */
export const DEFAULT_TIMEZONE = "Australia/Perth";

/**
 * The Operator: the business that subscribes. This is the tenant — every other
 * tenant-owned table points at it.
 *
 * Only `legalName` is required at creation. An Admin creates the Operator with
 * the bare minimum to send an invite; the Operator fills in the rest through
 * the setup checklist, so the remaining business details are nullable.
 */
export const operators = pgTable("operators", {
  ...primaryKeyColumn,

  legalName: text("legal_name").notNull(),
  tradingName: text("trading_name"),
  abn: varchar("abn", { length: ABN_LENGTH }),
  gstRegistered: boolean("gst_registered").notNull().default(false),
  gstRegisteredFrom: date("gst_registered_from"),

  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  suburb: text("suburb"),
  state: australianStateEnum("state"),
  postcode: varchar("postcode", { length: POSTCODE_LENGTH }),

  phone: text("phone"),
  email: text("email"),

  /** Storage key for the logo used on contracts, invoices and emails. */
  logoFileKey: text("logo_file_key"),

  /** IANA timezone name, e.g. "Australia/Perth". */
  timezone: text("timezone").notNull().default(DEFAULT_TIMEZONE),

  stripeAccountId: text("stripe_account_id").unique(),
  stripeChargesEnabled: boolean("stripe_charges_enabled").notNull().default(false),
  stripePayoutsEnabled: boolean("stripe_payouts_enabled").notNull().default(false),
  stripeBecsCapabilityStatus: text("stripe_becs_capability_status"),

  subscriptionStatus: subscriptionStatusEnum("subscription_status").notNull().default("trial"),

  ...auditColumns,
});

/**
 * The tenancy column, spelled identically on every tenant-owned table so the
 * row-level security policies and the structural test can both rely on it.
 * See rule 1 in CLAUDE.md.
 */
export const operatorIdColumn = {
  operatorId: uuid("operator_id")
    .notNull()
    .references(() => operators.id),
} as const;
