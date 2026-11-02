import { CLAIM_STATUSES, DAMAGE_STATUSES, OUTLINE_SCALE } from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { auditColumns, primaryKeyColumn, timestampColumns } from "./columns";
import { inspectionDamageMarks, inspectionLink } from "./inspections";
import { operatorIdColumn } from "./operators";
import { rentalLink } from "./rentals";
import { renters } from "./renters";
import { users } from "./users";
import { insurancePolicies } from "./vehicle-paperwork";
import { carLink } from "./vehicles";

export const damageStatusEnum = pgEnum("damage_status", DAMAGE_STATUSES);
export const claimStatusEnum = pgEnum("claim_status", CLAIM_STATUSES);

/**
 * One piece of damage on a car (docs/design/05): found at a return (one per
 * new damage mark, from its checklist) or any other time. Who had the car
 * is worked out from possession (rule 15) and confirmed by the Operator.
 * Archived, never deleted (rule 13).
 */
export const damageRecords = pgTable(
  "damage_records",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    vehicleId: uuid("vehicle_id").notNull(),
    /** The rental and Renter it happened under, when known. */
    rentalId: uuid("rental_id"),
    renterId: uuid("renter_id"),
    /** The day it was found, on the Operator's calendar. */
    foundOn: date("found_on").notNull(),
    description: text("description").notNull(),
    /** Where on the car outline (0 to OUTLINE_SCALE across and down); both or neither. */
    x: smallint("x"),
    y: smallint("y"),
    status: damageStatusEnum("status").notNull().default("open"),
    /** Why it is not being repaired, or anything else worth keeping. */
    statusNote: text("status_note"),
    /** Found at a return: that checklist, and its damage mark (with the mark's photo). */
    returnInspectionId: uuid("return_inspection_id"),
    damageMarkId: uuid("damage_mark_id"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...auditColumns,
  },
  (table) => [
    carLink("damage_records", table),
    rentalLink("damage_records", table),
    foreignKey({
      name: "damage_records_renter_fk",
      columns: [table.renterId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    inspectionLink("damage_records", {
      inspectionId: table.returnInspectionId,
      operatorId: table.operatorId,
    }),
    foreignKey({
      name: "damage_records_mark_fk",
      columns: [table.damageMarkId, table.operatorId],
      foreignColumns: [inspectionDamageMarks.id, inspectionDamageMarks.operatorId],
    }),
    unique("damage_records_id_operator_unique").on(table.id, table.operatorId),
    // One record per damage mark, so a return run twice never doubles them.
    unique("damage_records_one_per_mark").on(table.operatorId, table.damageMarkId),
    index("damage_records_vehicle_idx").on(table.operatorId, table.vehicleId, table.foundOn),
    index("damage_records_rental_idx").on(table.operatorId, table.rentalId),
    check(
      "damage_records_position",
      sql`(${table.x} is null) = (${table.y} is null)
        and (${table.x} is null or (${table.x} between 0 and ${sql.raw(String(OUTLINE_SCALE))}
          and ${table.y} between 0 and ${sql.raw(String(OUTLINE_SCALE))}))`,
    ),
    check(
      "damage_records_not_repairing_note",
      sql`${table.status} <> 'not_repairing' or ${table.statusNote} is not null`,
    ),
    check(
      "damage_records_from_return",
      sql`(${table.damageMarkId} is null) or (${table.returnInspectionId} is not null)`,
    ),
  ],
);

/**
 * The insurance claim for a damage record, if one is made: one per record.
 * The insurer is kept as text as well as the policy, so it reads right even
 * if the policy is later archived. Amounts are whole cents (rule 9).
 */
export const insuranceClaims = pgTable(
  "insurance_claims",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    damageRecordId: uuid("damage_record_id").notNull(),
    /** The car's policy on the day it was found, when it had one. */
    policyId: uuid("policy_id"),
    insurer: text("insurer").notNull(),
    /** The insurer's reference, in capitals. */
    claimNumber: text("claim_number"),
    status: claimStatusEnum("status").notNull().default("not_lodged"),
    /** Filled in from the policy; can be changed for this claim. */
    excessCents: integer("excess_cents"),
    lodgedOn: date("lodged_on"),
    settledOn: date("settled_on"),
    payoutCents: integer("payout_cents"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...timestampColumns,
  },
  (table) => [
    foreignKey({
      name: "insurance_claims_damage_record_fk",
      columns: [table.damageRecordId, table.operatorId],
      foreignColumns: [damageRecords.id, damageRecords.operatorId],
    }),
    foreignKey({
      name: "insurance_claims_policy_fk",
      columns: [table.policyId, table.operatorId],
      foreignColumns: [insurancePolicies.id, insurancePolicies.operatorId],
    }),
    // Counted within the business, so another business never learns a claim exists.
    unique("insurance_claims_one_per_damage").on(table.operatorId, table.damageRecordId),
    index("insurance_claims_operator_status_idx").on(table.operatorId, table.status),
    check(
      "insurance_claims_excess",
      sql`${table.excessCents} is null or ${table.excessCents} >= 0`,
    ),
    check(
      "insurance_claims_payout",
      sql`${table.payoutCents} is null or ${table.payoutCents} >= 0`,
    ),
    check(
      "insurance_claims_dates",
      sql`${table.settledOn} is null or ${table.lodgedOn} is null or ${table.settledOn} >= ${table.lodgedOn}`,
    ),
  ],
);
