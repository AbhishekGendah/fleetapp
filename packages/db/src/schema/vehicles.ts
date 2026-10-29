import {
  BODY_TYPES,
  EARLIEST_VEHICLE_YEAR,
  FUEL_TYPES,
  MAXIMUM_ODOMETER_KM,
  MAXIMUM_SEATS,
  TRANSMISSIONS,
  VEHICLE_STATUSES,
} from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  boolean,
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

import { auditColumns, primaryKeyColumn } from "./columns";
import { australianStateEnum } from "./enums";
import { operatorIdColumn } from "./operators";
import { users } from "./users";

export const vehicleStatusEnum = pgEnum("vehicle_status", VEHICLE_STATUSES);
export const bodyTypeEnum = pgEnum("body_type", BODY_TYPES);
export const transmissionEnum = pgEnum("transmission", TRANSMISSIONS);
export const fuelTypeEnum = pgEnum("fuel_type", FUEL_TYPES);

/** Named so the app can tell a duplicate rego or VIN from any other failure. */
export const VEHICLE_REGO_UNIQUE_INDEX = "vehicles_one_rego_per_operator";
export const VEHICLE_VIN_UNIQUE_INDEX = "vehicles_one_vin_per_operator";

/** Well beyond any car still on the road; the form applies the real limit. */
const LATEST_ALLOWED_YEAR = 2100;

/**
 * An Operator's car (docs/design/02). Archived, never deleted (rule 13).
 *
 * Make and model are text, not a link to the built-in list, so a car not in
 * the list can be saved and editing the list never changes a saved car.
 */
export const vehicles = pgTable(
  "vehicles",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,

    /** Capitals, no spaces: see `normaliseRego`. */
    rego: text("rego").notNull(),
    regoState: australianStateEnum("rego_state").notNull(),
    vin: text("vin"),
    make: text("make").notNull(),
    model: text("model").notNull(),
    variant: text("variant"),
    year: integer("year").notNull(),
    colour: text("colour"),
    bodyType: bodyTypeEnum("body_type"),
    transmission: transmissionEnum("transmission"),
    fuelType: fuelTypeEnum("fuel_type"),
    seats: integer("seats"),

    status: vehicleStatusEnum("status").notNull().default("available"),
    /** Why it is in service or off road, and when it is expected back. */
    statusReason: text("status_reason"),
    statusExpectedBack: date("status_expected_back"),

    ...auditColumns,
  },
  (table) => [
    // Lets other tables point at a car *and* its Operator together, so a row
    // can never link one Operator's record to another Operator's car.
    unique("vehicles_id_operator_unique").on(table.id, table.operatorId),
    // One car per plate per Operator. An archived car's plate can be reused.
    uniqueIndex(VEHICLE_REGO_UNIQUE_INDEX)
      .on(table.operatorId, table.regoState, table.rego)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex(VEHICLE_VIN_UNIQUE_INDEX)
      .on(table.operatorId, table.vin)
      .where(sql`${table.vin} is not null and ${table.archivedAt} is null`),
    index("vehicles_operator_idx").on(table.operatorId, table.rego),
    check(
      "vehicles_status_return_details",
      sql`(${table.status} in ('in_service', 'off_road')) = (${table.statusReason} is not null and ${table.statusExpectedBack} is not null)
        and (${table.statusReason} is null) = (${table.statusExpectedBack} is null)`,
    ),
    check(
      "vehicles_year_range",
      sql`${table.year} between ${sql.raw(String(EARLIEST_VEHICLE_YEAR))} and ${sql.raw(String(LATEST_ALLOWED_YEAR))}`,
    ),
    check(
      "vehicles_seats_range",
      sql`${table.seats} between 1 and ${sql.raw(String(MAXIMUM_SEATS))}`,
    ),
  ],
);

/** Where a reading came from. Only purchase and manual are used until rentals and servicing exist. */
export const ODOMETER_SOURCES = [
  "purchase",
  "handover",
  "return",
  "service",
  "renter",
  "manual",
] as const;
export const odometerSourceEnum = pgEnum("odometer_source", ODOMETER_SOURCES);
export type OdometerSource = (typeof ODOMETER_SOURCES)[number];

/**
 * Odometer readings: a record of what was seen, never changed. A reading
 * entered by mistake is withdrawn (and logged), not edited or deleted.
 */
export const odometerReadings = pgTable(
  "odometer_readings",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    vehicleId: uuid("vehicle_id").notNull(),

    kilometres: integer("kilometres").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    source: odometerSourceEnum("source").notNull(),
    /** Renter-sent readings are unverified until the Operator confirms them. */
    isVerified: boolean("is_verified").notNull().default(true),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "odometer_readings_vehicle_fk",
      columns: [table.vehicleId, table.operatorId],
      foreignColumns: [vehicles.id, vehicles.operatorId],
    }),
    index("odometer_readings_vehicle_idx").on(table.operatorId, table.vehicleId, table.recordedAt),
    check(
      "odometer_readings_kilometres_range",
      sql`${table.kilometres} between 0 and ${sql.raw(String(MAXIMUM_ODOMETER_KM))}`,
    ),
  ],
);
