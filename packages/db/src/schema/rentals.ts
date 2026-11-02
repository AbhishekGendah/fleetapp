import { RENTAL_STATUSES, RENTAL_TYPES } from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
  type ForeignKeyBuilder,
} from "drizzle-orm/pg-core";

import { primaryKeyColumn, timestampColumns } from "./columns";
import { operatorIdColumn } from "./operators";
import { renters } from "./renters";
import { carLink } from "./vehicles";

export const rentalTypeEnum = pgEnum("rental_type", RENTAL_TYPES);
export const rentalStatusEnum = pgEnum("rental_status", RENTAL_STATUSES);

/**
 * A span of time, from (included) up to (not included), so one booking can
 * end exactly as the next begins. Written and read as Postgres's own text
 * form, e.g. ["2026-11-10 01:00:00+00",) for one with no end.
 */
export const timeRange = customType<{ data: string; driverData: string }>({
  dataType: () => "tstzrange",
});

/**
 * One rental of one car to one Renter (docs/design/04). The car is the one
 * they have now: a swap changes it, and the car holds below keep the history.
 * The Operator's settings are copied on when it is made (rule 14) and never
 * change after.
 */
export const rentals = pgTable(
  "rentals",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    renterId: uuid("renter_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),

    type: rentalTypeEnum("type").notNull(),
    status: rentalStatusEnum("status").notNull().default("draft"),
    plannedStart: timestamp("planned_start", { withTimezone: true }).notNull(),
    /** None while ongoing: the Renter's notice sets it. */
    plannedEnd: timestamp("planned_end", { withTimezone: true }),
    handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    /** ISO weekday rent is charged on: Monday 1 to Sunday 7. */
    chargeWeekday: smallint("charge_weekday").notNull(),
    bondCents: integer("bond_cents").notNull(),

    /** The Operator's settings when this rental was made, and the version they came from. */
    settingsSnapshot: jsonb("settings_snapshot").$type<Record<string, unknown>>().notNull(),
    settingsVersion: integer("settings_version").notNull(),

    notes: text("notes"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),

    ...timestampColumns,
  },
  (table) => [
    foreignKey({
      name: "rentals_renter_fk",
      columns: [table.renterId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    carLink("rentals", table),
    unique("rentals_id_operator_unique").on(table.id, table.operatorId),
    index("rentals_renter_idx").on(table.operatorId, table.renterId),
    index("rentals_vehicle_idx").on(table.operatorId, table.vehicleId),
    index("rentals_status_start_idx").on(table.operatorId, table.status, table.plannedStart),
    check(
      "rentals_period",
      sql`(${table.type} = 'ongoing') = (${table.plannedEnd} is null)
        and (${table.plannedEnd} is null or ${table.plannedEnd} > ${table.plannedStart})`,
    ),
    check("rentals_charge_weekday", sql`${table.chargeWeekday} between 1 and 7`),
    check("rentals_bond", sql`${table.bondCents} >= 0`),
    check(
      "rentals_cancelled",
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)
        and (${table.cancelledAt} is null) = (${table.cancellationReason} is null)`,
    ),
    check(
      "rentals_handed_over",
      sql`(${table.status} in ('active', 'returned', 'closed')) = (${table.handedOverAt} is not null)`,
    ),
    check(
      "rentals_returned",
      sql`(${table.status} in ('returned', 'closed')) = (${table.returnedAt} is not null)
        and (${table.returnedAt} is null or ${table.returnedAt} >= ${table.handedOverAt})`,
    ),
  ],
);

/** The two-column link to a rental. */
export function rentalLink(
  name: string,
  table: { rentalId: AnyPgColumn; operatorId: AnyPgColumn },
): ForeignKeyBuilder {
  return foreignKey({
    name: `${name}_rental_fk`,
    columns: [table.rentalId, table.operatorId],
    foreignColumns: [rentals.id, rentals.operatorId],
  });
}

/**
 * The weekly rate and the date it applies from. Added to, never changed
 * (rule 9's history): a new rate is a new row, so past weeks keep theirs.
 */
export const rentalRates = pgTable(
  "rental_rates",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    weeklyRateCents: integer("weekly_rate_cents").notNull(),
    appliesFrom: date("applies_from").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    rentalLink("rental_rates", table),
    unique("rental_rates_rental_date_unique").on(
      table.operatorId,
      table.rentalId,
      table.appliesFrom,
    ),
    check("rental_rates_amount", sql`${table.weeklyRateCents} > 0`),
  ],
);

/**
 * A car kept for a rental over a span of time. The database refuses two
 * holds on one car that overlap (rule 18): see the migration's exclusion
 * rule, which drizzle cannot describe. A swap ends one hold and starts
 * another; a return ends the hold at the return; a cancellation releases it.
 */
export const carHolds = pgTable(
  "car_holds",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    vehicleId: uuid("vehicle_id").notNull(),
    rentalId: uuid("rental_id").notNull(),
    heldDuring: timeRange("held_during").notNull(),
    /** Set when the hold no longer counts (the rental was cancelled). */
    releasedAt: timestamp("released_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    carLink("car_holds", table),
    rentalLink("car_holds", table),
    index("car_holds_rental_idx").on(table.operatorId, table.rentalId),
  ],
);
