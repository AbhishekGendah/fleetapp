import {
  FUEL_LEVELS,
  INSPECTION_KINDS,
  INSPECTION_STATUSES,
  OUTLINE_SCALE,
  SIGNATURE_METHODS,
} from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type ForeignKeyBuilder,
} from "drizzle-orm/pg-core";

import { primaryKeyColumn, timestampColumns } from "./columns";
import { operatorIdColumn } from "./operators";
import { rentalLink, timeRange } from "./rentals";
import { renters } from "./renters";
import { users } from "./users";
import { carLink } from "./vehicles";

export const inspectionKindEnum = pgEnum("inspection_kind", INSPECTION_KINDS);
export const inspectionStatusEnum = pgEnum("inspection_status", INSPECTION_STATUSES);
export const fuelLevelEnum = pgEnum("fuel_level", FUEL_LEVELS);

/**
 * A handover or return checklist for one rental's car (docs/design/05):
 * filled in on the Operator's phone, then completed (the handover once the
 * Renter accepts it) or cancelled. Once it is no longer in progress the
 * database refuses any change to it (rule 12).
 */
export const inspections = pgTable(
  "inspections",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    kind: inspectionKindEnum("kind").notNull(),
    status: inspectionStatusEnum("status").notNull().default("in_progress"),
    /** The photos asked for, from the rental's settings when the checklist began (rule 14). */
    photoNames: text("photo_names").array().notNull(),
    odometerKm: integer("odometer_km"),
    fuelLevel: fuelLevelEnum("fuel_level"),
    keysCount: smallint("keys_count"),
    accessories: text("accessories"),
    notes: text("notes"),
    /** Why the car went before the full bond was held, when the rental's rules wanted it first. */
    bondOverrideReason: text("bond_override_reason"),
    /** Why the car went without a working direct debit, when the rental's rules wanted one first. */
    directDebitOverrideReason: text("direct_debit_override_reason"),
    /** Why the car went with no insurance on file for the day (review A8-2). Never logged. */
    insuranceOverrideReason: text("insurance_override_reason"),
    /** Why the car went with no rego on file for the day (review A8-2). Never logged. */
    regoOverrideReason: text("rego_override_reason"),
    startedByUserId: uuid("started_by_user_id")
      .notNull()
      .references(() => users.id),
    /** The words the Renter accepted, exactly as shown, and when. */
    acceptanceText: text("acceptance_text"),
    /**
     * A return the Renter was not there for (an after-hours drop-off): the
     * acceptance then holds what the business recorded instead.
     */
    isRenterAbsent: boolean("is_renter_absent").notNull().default(false),
    /** How the Renter signed on the business's phone: drawn or typed (review G9-10). */
    signatureMethod: text("signature_method", { enum: SIGNATURE_METHODS }),
    /** The name the Renter typed, when they typed it. */
    typedName: text("typed_name"),
    /**
     * One of a car swap's pair (the old car's return, the new car's
     * handover): the rental's own first handover and final return are not.
     */
    isForSwap: boolean("is_for_swap").notNull().default(false),
    /**
     * One of a driver change's pair (the car checked in from the driver who
     * had it, then signed for by the new one): finished only with the change.
     */
    isForDriverChange: boolean("is_for_driver_change").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    rentalLink("inspections", table),
    carLink("inspections", table),
    unique("inspections_id_operator_unique").on(table.id, table.operatorId),
    index("inspections_rental_idx").on(table.operatorId, table.rentalId),
    // One checklist of each kind under way per rental, and one finished handover
    // and return outside car swaps and driver changes (each adds its own pair).
    uniqueIndex("inspections_one_in_progress")
      .on(table.operatorId, table.rentalId, table.kind)
      .where(sql`${table.status} = 'in_progress'`),
    uniqueIndex("inspections_one_completed")
      .on(table.operatorId, table.rentalId, table.kind)
      .where(
        sql`${table.status} = 'completed' and not ${table.isForSwap} and not ${table.isForDriverChange}`,
      ),
    check("inspections_one_pair", sql`not (${table.isForSwap} and ${table.isForDriverChange})`),
    check("inspections_odometer", sql`${table.odometerKm} is null or ${table.odometerKm} >= 0`),
    check(
      "inspections_keys",
      sql`${table.keysCount} is null or ${table.keysCount} between 1 and 9`,
    ),
    check(
      "inspections_completed",
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)
        and (${table.status} <> 'completed' or (${table.odometerKm} is not null
          and ${table.fuelLevel} is not null and ${table.keysCount} is not null
          and ${table.acceptanceText} is not null))`,
    ),
    check(
      "inspections_renter_absent_on_return",
      sql`${table.kind} = 'return' or not ${table.isRenterAbsent}`,
    ),
    check(
      "inspections_signature",
      sql`(${table.signatureMethod} is null or ${table.signatureMethod} in ('drawn', 'typed'))
        and (${table.signatureMethod} = 'typed') = (${table.typedName} is not null)`,
    ),
    check(
      "inspections_cancelled",
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)`,
    ),
  ],
);

/** The two-column link to an inspection. */
export function inspectionLink(
  name: string,
  table: { inspectionId: AnyPgColumn; operatorId: AnyPgColumn },
): ForeignKeyBuilder {
  return foreignKey({
    name: `${name}_inspection_fk`,
    columns: [table.inspectionId, table.operatorId],
    foreignColumns: [inspections.id, inspections.operatorId],
  });
}

/** Named so saving a mark sent twice can find the first. */
export const DAMAGE_MARK_CLIENT_KEY_INDEX = "inspection_damage_marks_one_per_phone_key";

/**
 * Damage already on the car, marked on the outline (across and down, 0 to
 * OUTLINE_SCALE) with a description; its photo is a file pointing here.
 * Removed while the checklist is under way by marking it removed, never by
 * deleting; fixed once the checklist is finished.
 */
export const inspectionDamageMarks = pgTable(
  "inspection_damage_marks",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    inspectionId: uuid("inspection_id").notNull(),
    x: smallint("x").notNull(),
    y: smallint("y").notNull(),
    description: text("description").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    /**
     * The phone's own key for the mark: sending it again on patchy signal
     * finds the mark already saved instead of adding a second (review A6-5).
     * Only ever the phone's: a driver change's copies use copiedFromMarkId.
     */
    clientKey: uuid("client_key"),
    /**
     * For a mark a driver change copied onto the new driver's checklist (the
     * damage already on the car): the mark it shows, whose photo is its photo,
     * so each photo is stored once (rule 21). Always the first mark, never
     * another copy. Null for a mark made on the checklist itself.
     */
    copiedFromMarkId: uuid("copied_from_mark_id"),
    ...timestampColumns,
  },
  (table) => [
    inspectionLink("inspection_damage_marks", table),
    foreignKey({
      name: "inspection_damage_marks_copied_from_fk",
      columns: [table.copiedFromMarkId, table.operatorId],
      foreignColumns: [table.id, table.operatorId],
    }),
    uniqueIndex(DAMAGE_MARK_CLIENT_KEY_INDEX)
      .on(table.operatorId, table.inspectionId, table.clientKey)
      .where(sql`${table.clientKey} is not null`),
    unique("inspection_damage_marks_id_operator_unique").on(table.id, table.operatorId),
    index("inspection_damage_marks_inspection_idx").on(table.operatorId, table.inspectionId),
    check(
      "inspection_damage_marks_position",
      sql`${table.x} between 0 and ${sql.raw(String(OUTLINE_SCALE))}
        and ${table.y} between 0 and ${sql.raw(String(OUTLINE_SCALE))}`,
    ),
  ],
);

/**
 * Who had which car when (rule 15): from the signed acceptance at the
 * handover (by the Renter or, for a business, its driver) to the recorded
 * return. Fines are matched to these, never to the rental's current driver.
 * The database refuses two possessions of one car that overlap (see the
 * migration's exclusion rule); a car swap or a driver change ends one and
 * starts another.
 */
export const possessions = pgTable(
  "possessions",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    /** The rental's Renter (who pays), as it was then. */
    renterId: uuid("renter_id").notNull(),
    /** Who had the car: the rental's driver when this started (the database checks it). */
    driverId: uuid("driver_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** None while the Renter still has the car. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    heldDuring: timeRange("held_during").generatedAlwaysAs(
      sql`tstzrange(started_at, ended_at, '[)')`,
    ),
    handoverInspectionId: uuid("handover_inspection_id").notNull(),
    returnInspectionId: uuid("return_inspection_id"),
    ...timestampColumns,
  },
  (table) => [
    rentalLink("possessions", table),
    carLink("possessions", table),
    foreignKey({
      name: "possessions_renter_fk",
      columns: [table.renterId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    foreignKey({
      name: "possessions_driver_fk",
      columns: [table.driverId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    foreignKey({
      name: "possessions_handover_fk",
      columns: [table.handoverInspectionId, table.operatorId],
      foreignColumns: [inspections.id, inspections.operatorId],
    }),
    foreignKey({
      name: "possessions_return_fk",
      columns: [table.returnInspectionId, table.operatorId],
      foreignColumns: [inspections.id, inspections.operatorId],
    }),
    index("possessions_vehicle_idx").on(table.operatorId, table.vehicleId, table.startedAt),
    index("possessions_rental_idx").on(table.operatorId, table.rentalId),
    index("possessions_driver_idx").on(table.operatorId, table.driverId, table.startedAt),
    uniqueIndex("possessions_one_open_per_rental")
      .on(table.operatorId, table.rentalId)
      .where(sql`${table.endedAt} is null`),
    check(
      "possessions_period",
      sql`${table.endedAt} is null or ${table.endedAt} > ${table.startedAt}`,
    ),
  ],
);
