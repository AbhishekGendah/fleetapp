import { PURCHASE_SOURCES, VEHICLE_COST_KINDS } from "@fleetapp/core";
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
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { auditColumns, primaryKeyColumn } from "./columns";
import { australianStateEnum } from "./enums";
import { operatorIdColumn } from "./operators";
import { amountChecks } from "./vehicle-paperwork";
import { vehicles } from "./vehicles";

export const purchaseSourceEnum = pgEnum("purchase_source", PURCHASE_SOURCES);
export const vehicleCostKindEnum = pgEnum("vehicle_cost_kind", VEHICLE_COST_KINDS);

/** The two-column link to a car, so no row can point at another Operator's car. */
function carLink(name: string, table: { vehicleId: AnyPgColumn; operatorId: AnyPgColumn }) {
  return foreignKey({
    name: `${name}_vehicle_fk`,
    columns: [table.vehicleId, table.operatorId],
    foreignColumns: [vehicles.id, vehicles.operatorId],
  });
}

/**
 * How a car was bought: one per car. The seller's details are kept for
 * proving when ownership changed. The odometer at purchase is a reading
 * (source "purchase"), not a column here.
 */
export const vehiclePurchases = pgTable(
  "vehicle_purchases",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    vehicleId: uuid("vehicle_id").notNull(),

    purchasedOn: date("purchased_on").notNull(),
    source: purchaseSourceEnum("source").notNull(),
    sellerName: text("seller_name").notNull(),
    sellerPhone: text("seller_phone"),
    sellerAddress: text("seller_address"),
    priceCents: integer("price_cents").notNull(),
    gstCents: integer("gst_cents").notNull().default(0),

    ...auditColumns,
  },
  (table) => [
    carLink("vehicle_purchases", table),
    uniqueIndex("vehicle_purchases_one_per_car").on(table.operatorId, table.vehicleId),
    // A private seller charges no GST.
    check(
      "vehicle_purchases_private_no_gst",
      sql`${table.source} <> 'private' or ${table.gstCents} = 0`,
    ),
    ...amountChecks("vehicle_purchases", table.priceCents, table.gstCents),
  ],
);

/**
 * A car's sale. The moment of handover is kept to the minute, because a
 * fine on the sale day may fall either side of it. A sale that falls through
 * is cancelled, not deleted; a car has at most one sale that is not.
 */
export const vehicleSales = pgTable(
  "vehicle_sales",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    vehicleId: uuid("vehicle_id").notNull(),

    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
    priceCents: integer("price_cents").notNull(),
    gstCents: integer("gst_cents").notNull().default(0),
    buyerName: text("buyer_name").notNull(),
    buyerPhone: text("buyer_phone").notNull(),
    buyerAddress: text("buyer_address").notNull(),
    /** Never written to any log (rule 7). */
    buyerLicenceNumber: text("buyer_licence_number"),
    buyerLicenceState: australianStateEnum("buyer_licence_state"),
    transferLodgedOn: date("transfer_lodged_on"),
    transferReference: text("transfer_reference"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    ...auditColumns,
  },
  (table) => [
    carLink("vehicle_sales", table),
    uniqueIndex("vehicle_sales_one_active_per_car")
      .on(table.operatorId, table.vehicleId)
      .where(sql`${table.cancelledAt} is null`),
    ...amountChecks("vehicle_sales", table.priceCents, table.gstCents),
  ],
);

/** Anything else spent on a car. A wrong entry is archived, never deleted. */
export const vehicleCosts = pgTable(
  "vehicle_costs",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    vehicleId: uuid("vehicle_id").notNull(),

    incurredOn: date("incurred_on").notNull(),
    kind: vehicleCostKindEnum("kind").notNull(),
    description: text("description").notNull(),
    costCents: integer("cost_cents").notNull(),
    gstCents: integer("gst_cents").notNull().default(0),

    ...auditColumns,
  },
  (table) => [
    carLink("vehicle_costs", table),
    index("vehicle_costs_vehicle_idx").on(table.operatorId, table.vehicleId, table.incurredOn),
    ...amountChecks("vehicle_costs", table.costCents, table.gstCents),
  ],
);
