import { DRIVER_CHANGE_STATUSES } from "@fleetapp/core";
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
import { inspectionLink, inspections } from "./inspections";
import { operatorIdColumn } from "./operators";
import { rentalLink } from "./rentals";
import { renters } from "./renters";
import { users } from "./users";

export const driverChangeStatusEnum = pgEnum("driver_change_status", DRIVER_CHANGE_STATUSES);

/**
 * One change of a business's driver while its car is out (docs/plans/
 * business-renters.md, Migration C): the car checked in from the driver who
 * has it (the return checklist; they may not be there to sign) and signed
 * for by the new driver (the handover checklist). Possession moves from one
 * driver to the other at that signature (rule 15). The same shape and
 * protections as a car swap; kept for good once finished.
 */
export const rentalDriverChanges = pgTable(
  "rental_driver_changes",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    /** The driver who had the car: the rental's driver when the change began. */
    fromDriverId: uuid("from_driver_id").notNull(),
    toDriverId: uuid("to_driver_id").notNull(),
    reason: text("reason").notNull(),
    status: driverChangeStatusEnum("status").notNull().default("in_progress"),
    returnInspectionId: uuid("return_inspection_id").notNull(),
    handoverInspectionId: uuid("handover_inspection_id").notNull(),
    /** The new driver's acceptance: one possession ends and the next starts at this moment. */
    changedAt: timestamp("changed_at", { withTimezone: true }),
    startedByUserId: uuid("started_by_user_id")
      .notNull()
      .references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    rentalLink("rental_driver_changes", table),
    foreignKey({
      name: "rental_driver_changes_from_driver_fk",
      columns: [table.fromDriverId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    foreignKey({
      name: "rental_driver_changes_to_driver_fk",
      columns: [table.toDriverId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    inspectionLink("rental_driver_changes_return", {
      inspectionId: table.returnInspectionId,
      operatorId: table.operatorId,
    }),
    foreignKey({
      name: "rental_driver_changes_handover_inspection_fk",
      columns: [table.handoverInspectionId, table.operatorId],
      foreignColumns: [inspections.id, inspections.operatorId],
    }),
    unique("rental_driver_changes_id_operator_unique").on(table.id, table.operatorId),
    index("rental_driver_changes_rental_idx").on(table.operatorId, table.rentalId),
    // One driver change under way per rental.
    uniqueIndex("rental_driver_changes_one_in_progress")
      .on(table.operatorId, table.rentalId)
      .where(sql`${table.status} = 'in_progress'`),
    check("rental_driver_changes_other_driver", sql`${table.fromDriverId} <> ${table.toDriverId}`),
    check("rental_driver_changes_reason", sql`length(trim(${table.reason})) > 0`),
    check(
      "rental_driver_changes_completed",
      sql`(${table.status} = 'completed') = (${table.changedAt} is not null)`,
    ),
    check(
      "rental_driver_changes_cancelled",
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)`,
    ),
  ],
);
