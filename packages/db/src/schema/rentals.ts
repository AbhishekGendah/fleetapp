import { RENT_MODELS, RENTAL_STATUSES, RENTAL_TYPES } from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  boolean,
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
export const rentModelEnum = pgEnum("rent_model", RENT_MODELS);

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
    /** Who pays and is party to the contract: a person, or a business. */
    renterId: uuid("renter_id").notNull(),
    /**
     * Who drives (rule 15): the Renter themselves for a person, which the
     * database fills in; for a business, one of its current drivers, or none
     * yet while a draft or booking ("to be named"). Possessions keep who had
     * the car at each moment; this is only who has it now or next.
     */
    driverId: uuid("driver_id"),
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

    /** How rent is worked out; the rent run charges `blocks` rentals only. */
    rentModel: rentModelEnum("rent_model").notNull().default("weekday"),
    /** Copied at booking (rule 14): long-term rentals pay a week of blocks at a time. */
    isLongTerm: boolean("is_long_term"),
    /** Minutes past the last whole block that are free at the return. */
    graceMinutes: smallint("grace_minutes"),
    /** A long-term rental back in fewer blocks than this is re-priced at the daily rate. */
    longTermMinimumDays: smallint("long_term_minimum_days"),
    /** The blocks booked; none for an ongoing rental. */
    bookedBlocks: integer("booked_blocks"),
    /** Why the business waived the daily-rate re-pricing at the return, if it did. */
    dailyRateWaivedReason: text("daily_rate_waived_reason"),
    /**
     * The business paused this rental's automatic debits (a payment
     * arrangement, a dispute), and why. Set and cleared together, by Pause
     * and Resume only (docs/plans/phase-4-slice-5.md).
     */
    debitsPausedAt: timestamp("debits_paused_at", { withTimezone: true }),
    debitsPausedReason: text("debits_paused_reason"),

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
    foreignKey({
      name: "rentals_driver_fk",
      columns: [table.driverId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    carLink("rentals", table),
    unique("rentals_id_operator_unique").on(table.id, table.operatorId),
    index("rentals_renter_idx").on(table.operatorId, table.renterId),
    index("rentals_driver_idx").on(table.operatorId, table.driverId),
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
      "rentals_block_terms",
      sql`(${table.rentModel} = 'blocks') = (${table.isLongTerm} is not null
          and ${table.graceMinutes} is not null and ${table.longTermMinimumDays} is not null)
        and (${table.graceMinutes} is null or ${table.graceMinutes} between 0 and 240)
        and (${table.longTermMinimumDays} is null or ${table.longTermMinimumDays} between 1 and 90)
        and (${table.bookedBlocks} is null or ${table.bookedBlocks} > 0)
        and (${table.rentModel} = 'weekday' or ${table.isLongTerm} or ${table.bookedBlocks} is not null)
        and (${table.dailyRateWaivedReason} is null
          or (${table.isLongTerm} and length(trim(${table.dailyRateWaivedReason})) > 0))`,
    ),
    check(
      "rentals_debits_paused",
      sql`(${table.debitsPausedAt} is null) = (${table.debitsPausedReason} is null)
        and (${table.debitsPausedReason} is null or length(trim(${table.debitsPausedReason})) > 0)`,
    ),
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
      "rentals_driver_when_out",
      sql`${table.status} not in ('active', 'returned', 'closed') or ${table.driverId} is not null`,
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
 * A rental's rate and where it applies from. Added to, never changed
 * (rule 9's history): a new rate is a new row, so past weeks keep theirs.
 * Block rentals say the block it starts at (a week start for long-term
 * rentals) and carry the daily rate; weekday rentals said a date.
 */
export const rentalRates = pgTable(
  "rental_rates",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    /** The weekly price; none on a block rental priced by the day only. */
    weeklyRateCents: integer("weekly_rate_cents"),
    appliesFrom: date("applies_from"),
    dailyRateCents: integer("daily_rate_cents"),
    appliesFromBlock: integer("applies_from_block"),
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
    unique("rental_rates_rental_block_unique").on(
      table.operatorId,
      table.rentalId,
      table.appliesFromBlock,
    ),
    check(
      "rental_rates_amount",
      sql`(${table.weeklyRateCents} is null or ${table.weeklyRateCents} > 0)
        and (${table.dailyRateCents} is null or ${table.dailyRateCents} > 0)`,
    ),
    check(
      "rental_rates_start",
      sql`(${table.appliesFrom} is null) <> (${table.appliesFromBlock} is null)
        and (${table.appliesFrom} is null or ${table.weeklyRateCents} is not null)
        and (${table.appliesFromBlock} is null
          or (${table.appliesFromBlock} >= 0 and ${table.dailyRateCents} is not null))`,
    ),
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
