import { CAR_SWAP_STATUSES } from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryKeyColumn, timestampColumns } from "./columns";
import { issuedDocuments } from "./contracts";
import { inspectionLink, inspections } from "./inspections";
import { operatorIdColumn } from "./operators";
import { rentalLink } from "./rentals";
import { users } from "./users";
import { vehicles, vehicleStatusEnum } from "./vehicles";

export const carSwapStatusEnum = pgEnum("car_swap_status", CAR_SWAP_STATUSES);

/**
 * One car swap during a rental (docs/plans/phase-3-slice-7.md, 7b): the old
 * car checked in as a return, the new car out as a handover, and the
 * Renter's signed swap form. Possession moves from one car to the other at
 * the Renter's acceptance (rule 15). Kept for good once finished, except
 * that the retention job clears its reason with a retired Renter's free
 * text (0058).
 */
export const carSwaps = pgTable(
  "car_swaps",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    fromVehicleId: uuid("from_vehicle_id").notNull(),
    toVehicleId: uuid("to_vehicle_id").notNull(),
    reason: text("reason").notNull(),
    status: carSwapStatusEnum("status").notNull().default("in_progress"),
    returnInspectionId: uuid("return_inspection_id").notNull(),
    handoverInspectionId: uuid("handover_inspection_id").notNull(),
    /** Where the old car went: Available, In service or Off road. */
    fromVehicleStatusAfter: vehicleStatusEnum("from_vehicle_status_after"),
    /** The Renter's acceptance on the phone: possession moves at this moment. */
    swappedAt: timestamp("swapped_at", { withTimezone: true }),
    /** The signed swap form. */
    documentId: uuid("document_id"),
    startedByUserId: uuid("started_by_user_id")
      .notNull()
      .references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    rentalLink("car_swaps", table),
    foreignKey({
      name: "car_swaps_from_vehicle_fk",
      columns: [table.fromVehicleId, table.operatorId],
      foreignColumns: [vehicles.id, vehicles.operatorId],
    }),
    foreignKey({
      name: "car_swaps_to_vehicle_fk",
      columns: [table.toVehicleId, table.operatorId],
      foreignColumns: [vehicles.id, vehicles.operatorId],
    }),
    inspectionLink("car_swaps_return", {
      inspectionId: table.returnInspectionId,
      operatorId: table.operatorId,
    }),
    foreignKey({
      name: "car_swaps_handover_inspection_fk",
      columns: [table.handoverInspectionId, table.operatorId],
      foreignColumns: [inspections.id, inspections.operatorId],
    }),
    foreignKey({
      name: "car_swaps_document_fk",
      columns: [table.documentId, table.operatorId],
      foreignColumns: [issuedDocuments.id, issuedDocuments.operatorId],
    }),
    unique("car_swaps_id_operator_unique").on(table.id, table.operatorId),
    index("car_swaps_rental_idx").on(table.operatorId, table.rentalId),
    // One swap under way per rental.
    uniqueIndex("car_swaps_one_in_progress")
      .on(table.operatorId, table.rentalId)
      .where(sql`${table.status} = 'in_progress'`),
    check("car_swaps_other_car", sql`${table.fromVehicleId} <> ${table.toVehicleId}`),
    check("car_swaps_reason", sql`length(trim(${table.reason})) > 0`),
    check(
      "car_swaps_completed",
      sql`(${table.status} = 'completed') = (${table.swappedAt} is not null)
        and (${table.status} <> 'completed' or (${table.documentId} is not null
          and ${table.fromVehicleStatusAfter} in ('available', 'in_service', 'off_road')))`,
    ),
    check(
      "car_swaps_cancelled",
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)`,
    ),
  ],
);
