import {
  DIRECT_DEBIT_TERM_MONTHS,
  INSURANCE_COVER_TYPES,
  INSURANCE_PAYMENT_FREQUENCIES,
  REGO_TERMS_MONTHS,
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
  type CheckBuilder,
} from "drizzle-orm/pg-core";

import { auditColumns, primaryKeyColumn } from "./columns";
import { australianStateEnum } from "./enums";
import { operatorIdColumn } from "./operators";
import { vehicles } from "./vehicles";

export const insuranceCoverTypeEnum = pgEnum("insurance_cover_type", INSURANCE_COVER_TYPES);
export const insurancePaymentFrequencyEnum = pgEnum(
  "insurance_payment_frequency",
  INSURANCE_PAYMENT_FREQUENCIES,
);

/** Money is whole cents, stored including GST, with its GST beside it (rule 9). */
export function amountChecks(
  prefix: string,
  cost: { name: string },
  gst: { name: string },
): CheckBuilder[] {
  return [
    check(`${prefix}_cost_not_negative`, sql`${sql.identifier(cost.name)} >= 0`),
    // At most one eleventh, rounded: the GST inside a GST-inclusive price.
    check(
      `${prefix}_gst_within_cost`,
      sql`${sql.identifier(gst.name)} >= 0 and ${sql.identifier(gst.name)} <= round(${sql.identifier(cost.name)} / 11.0)`,
    ),
  ];
}

/**
 * One rego renewal of a car (docs/design/02). The renewal with the latest
 * expiry is the car's current rego. A wrong entry is archived, never deleted.
 */
export const vehicleRegistrations = pgTable(
  "vehicle_registrations",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    vehicleId: uuid("vehicle_id").notNull(),

    state: australianStateEnum("state").notNull(),
    termMonths: integer("term_months").notNull(),
    /** Empty only for a monthly direct debit, which runs until stopped. */
    expiresOn: date("expires_on"),
    /** For a direct debit: paid on is when it started. */
    paidOn: date("paid_on"),
    directDebitStoppedOn: date("direct_debit_stopped_on"),
    costCents: integer("cost_cents").notNull(),
    gstCents: integer("gst_cents").notNull().default(0),

    ...auditColumns,
  },
  (table) => [
    foreignKey({
      name: "vehicle_registrations_vehicle_fk",
      columns: [table.vehicleId, table.operatorId],
      foreignColumns: [vehicles.id, vehicles.operatorId],
    }),
    index("vehicle_registrations_vehicle_idx").on(
      table.operatorId,
      table.vehicleId,
      table.expiresOn,
    ),
    check(
      "vehicle_registrations_term",
      sql`${table.termMonths} in (${sql.raw(REGO_TERMS_MONTHS.join(", "))})`,
    ),
    // A direct debit has no expiry and may be stopped; a fixed term has an expiry.
    check(
      "vehicle_registrations_direct_debit",
      sql`(${table.termMonths} = ${sql.raw(String(DIRECT_DEBIT_TERM_MONTHS))}) = (${table.expiresOn} is null)
        and (${table.directDebitStoppedOn} is null or ${table.termMonths} = ${sql.raw(String(DIRECT_DEBIT_TERM_MONTHS))})`,
    ),
    ...amountChecks("vehicle_registrations", table.costCents, table.gstCents),
  ],
);

/**
 * An insurance policy. Most cover one car; a fleet policy covers several,
 * listed in `insurance_policy_vehicles`.
 */
export const insurancePolicies = pgTable(
  "insurance_policies",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,

    insurer: text("insurer").notNull(),
    policyNumber: text("policy_number").notNull(),
    coverType: insuranceCoverTypeEnum("cover_type").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    /** Kept for damage recovery charges later. */
    excessCents: integer("excess_cents"),
    /** The premium is paid this often; `cost_cents` is one payment. */
    paymentFrequency: insurancePaymentFrequencyEnum("payment_frequency")
      .notNull()
      .default("yearly"),
    costCents: integer("cost_cents").notNull(),
    gstCents: integer("gst_cents").notNull().default(0),

    ...auditColumns,
  },
  (table) => [
    unique("insurance_policies_id_operator_unique").on(table.id, table.operatorId),
    index("insurance_policies_operator_idx").on(table.operatorId, table.endsOn),
    check("insurance_policies_dates", sql`${table.endsOn} > ${table.startsOn}`),
    check("insurance_policies_excess_not_negative", sql`${table.excessCents} >= 0`),
    ...amountChecks("insurance_policies", table.costCents, table.gstCents),
  ],
);

/**
 * Which cars a policy covers. Taking a car off a policy closes its row
 * (`removed_at`) rather than deleting it, so the history shows which policy
 * covered a car when.
 */
export const insurancePolicyVehicles = pgTable(
  "insurance_policy_vehicles",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    policyId: uuid("policy_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),

    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "insurance_policy_vehicles_policy_fk",
      columns: [table.policyId, table.operatorId],
      foreignColumns: [insurancePolicies.id, insurancePolicies.operatorId],
    }),
    foreignKey({
      name: "insurance_policy_vehicles_vehicle_fk",
      columns: [table.vehicleId, table.operatorId],
      foreignColumns: [vehicles.id, vehicles.operatorId],
    }),
    uniqueIndex("insurance_policy_vehicles_one_active")
      .on(table.policyId, table.vehicleId)
      .where(sql`${table.removedAt} is null`),
    index("insurance_policy_vehicles_vehicle_idx").on(table.operatorId, table.vehicleId),
  ],
);
