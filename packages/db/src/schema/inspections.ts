import { FUEL_LEVELS, INSPECTION_KINDS, INSPECTION_STATUSES, OUTLINE_SCALE } from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
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
    startedByUserId: uuid("started_by_user_id")
      .notNull()
      .references(() => users.id),
    /** The words the Renter accepted, exactly as shown, and when. */
    acceptanceText: text("acceptance_text"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    rentalLink("inspections", table),
    carLink("inspections", table),
    unique("inspections_id_operator_unique").on(table.id, table.operatorId),
    index("inspections_rental_idx").on(table.operatorId, table.rentalId),
    // One checklist of each kind under way per rental, and one finished handover.
    uniqueIndex("inspections_one_in_progress")
      .on(table.operatorId, table.rentalId, table.kind)
      .where(sql`${table.status} = 'in_progress'`),
    uniqueIndex("inspections_one_completed")
      .on(table.operatorId, table.rentalId, table.kind)
      .where(sql`${table.status} = 'completed'`),
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
    ...timestampColumns,
  },
  (table) => [
    inspectionLink("inspection_damage_marks", table),
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
 * Who had which car when (rule 15): from the Renter's signed acceptance at
 * the handover to the recorded return. Fines are matched to these. The
 * database refuses two possessions of one car that overlap (see the
 * migration's exclusion rule); a car swap ends one and starts another.
 */
export const possessions = pgTable(
  "possessions",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    renterId: uuid("renter_id").notNull(),
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
    uniqueIndex("possessions_one_open_per_rental")
      .on(table.operatorId, table.rentalId)
      .where(sql`${table.endedAt} is null`),
    check(
      "possessions_period",
      sql`${table.endedAt} is null or ${table.endedAt} > ${table.startedAt}`,
    ),
  ],
);
