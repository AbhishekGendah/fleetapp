import {
  BUILT_IN_CHARGE_TYPES,
  DEFAULT_GST_TREATMENT,
  GST_TREATMENTS,
  LEDGER_LINE_KINDS,
} from "@fleetapp/core";
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

import { paymentMethodEnum } from "./bonds";
import { primaryKeyColumn, timestampColumns } from "./columns";
import { damageRecords } from "./damage";
import { operatorIdColumn } from "./operators";
import { rentalLink } from "./rentals";
import { users } from "./users";

export const builtInChargeTypeEnum = pgEnum("built_in_charge_type", BUILT_IN_CHARGE_TYPES);
export const gstTreatmentEnum = pgEnum("gst_treatment", GST_TREATMENTS);
export const ledgerLineKindEnum = pgEnum("ledger_line_kind", LEDGER_LINE_KINDS);

/**
 * What a charge is for, with its GST treatment (rule 9): the built-in types
 * every business has (one row each, made when first needed) and the
 * business's own. A change of treatment applies to new lines only, as each
 * line stores its own GST. Archived, never deleted (rule 13).
 */
export const chargeTypes = pgTable(
  "charge_types",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    /** Set for a built-in type; its name comes from the app. */
    builtIn: builtInChargeTypeEnum("built_in"),
    /** The business's own type's name; none for a built-in one. */
    name: text("name"),
    gstTreatment: gstTreatmentEnum("gst_treatment").notNull().default(DEFAULT_GST_TREATMENT),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    unique("charge_types_id_operator_unique").on(table.id, table.operatorId),
    uniqueIndex("charge_types_one_built_in")
      .on(table.operatorId, table.builtIn)
      .where(sql`${table.builtIn} is not null`),
    check(
      "charge_types_named",
      sql`(${table.builtIn} is null) = (${table.name} is not null and length(trim(${table.name})) > 0)`,
    ),
  ],
);

/**
 * One line on a Renter's ledger (docs/design/06), tied to one of their
 * rentals. Only ever added (rule 11): the database refuses any change or
 * removal, and a correction is a reversal of exactly one line. The balance
 * is always the sum of the lines, never stored. Amounts and GST are
 * positive cents; the kind says which way the line moves the balance.
 */
export const ledgerLines = pgTable(
  "ledger_lines",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    kind: ledgerLineKindEnum("kind").notNull(),
    /** What a charge or credit is for. */
    chargeTypeId: uuid("charge_type_id"),
    amountCents: integer("amount_cents").notNull(),
    /** Worked out when the line is added and stored for good (rule 9). */
    gstCents: integer("gst_cents").notNull(),
    description: text("description").notNull(),
    /** The day it counts from, on the Operator's calendar. */
    effectiveOn: date("effective_on").notNull(),
    /** For rent and its credit: the days it covers, from the first to the day after the last. */
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    /** How a payment or refund moved (a type, never its details; rule 16). */
    method: paymentMethodEnum("method"),
    /** A bank transfer's reference or a receipt number, in capitals. */
    reference: text("reference"),
    /** The line a reversal undoes. */
    reversesId: uuid("reverses_id"),
    /** The damage a charge recovers. */
    damageRecordId: uuid("damage_record_id"),
    /** Who added it; none when the system did (the daily rent job). */
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    rentalLink("ledger_lines", table),
    unique("ledger_lines_id_rental_unique").on(table.id, table.operatorId, table.rentalId),
    foreignKey({
      name: "ledger_lines_charge_type_fk",
      columns: [table.chargeTypeId, table.operatorId],
      foreignColumns: [chargeTypes.id, chargeTypes.operatorId],
    }),
    // A reversal undoes a line of the same rental (and Operator), and each line only once.
    foreignKey({
      name: "ledger_lines_reverses_fk",
      columns: [table.reversesId, table.operatorId, table.rentalId],
      foreignColumns: [table.id, table.operatorId, table.rentalId],
    }),
    unique("ledger_lines_reversed_once").on(table.reversesId),
    foreignKey({
      name: "ledger_lines_damage_fk",
      columns: [table.damageRecordId, table.operatorId],
      foreignColumns: [damageRecords.id, damageRecords.operatorId],
    }),
    index("ledger_lines_rental_idx").on(table.operatorId, table.rentalId),
    // The daily job charging a period twice is refused here (rule 20), and so is a second
    // credit for the same period.
    uniqueIndex("ledger_lines_one_rent_per_period")
      .on(table.operatorId, table.rentalId, table.periodStart)
      .where(sql`${table.kind} = 'charge' and ${table.periodStart} is not null`),
    uniqueIndex("ledger_lines_one_credit_per_period")
      .on(table.operatorId, table.rentalId, table.periodStart)
      .where(sql`${table.kind} = 'credit' and ${table.periodStart} is not null`),
    check("ledger_lines_amount", sql`${table.amountCents} > 0`),
    check(
      "ledger_lines_gst",
      sql`${table.gstCents} >= 0 and ${table.gstCents} <= ${table.amountCents}`,
    ),
    check("ledger_lines_description", sql`length(trim(${table.description})) > 0`),
    check(
      "ledger_lines_reversal",
      sql`(${table.kind} = 'reversal') = (${table.reversesId} is not null)`,
    ),
    check(
      "ledger_lines_method",
      sql`(${table.kind} in ('payment', 'refund')) = (${table.method} is not null)`,
    ),
    check(
      "ledger_lines_charge_type",
      sql`(${table.kind} in ('charge', 'credit')) = (${table.chargeTypeId} is not null)`,
    ),
    check(
      "ledger_lines_period",
      sql`(${table.periodStart} is null) = (${table.periodEnd} is null)
        and (${table.periodStart} is null or (${table.kind} in ('charge', 'credit')
          and ${table.periodEnd} > ${table.periodStart}))`,
    ),
  ],
);
