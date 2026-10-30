import { carMoneyTotals, type CarMoneyTotals } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import {
  odometerReadings,
  vehicleCosts,
  vehiclePurchases,
  vehicleSales,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, isNull } from "drizzle-orm";

export type Purchase = Omit<typeof vehiclePurchases.$inferSelect, "operatorId">;
export type Sale = Omit<typeof vehicleSales.$inferSelect, "operatorId">;
export type Cost = Omit<typeof vehicleCosts.$inferSelect, "operatorId">;

export interface CarCosts {
  purchase: Purchase | null;
  /** The odometer at purchase, if one was entered. */
  purchaseKilometres: number | null;
  /** The sale that has not fallen through, if any. */
  sale: Sale | null;
  /** Current costs, newest first. */
  costs: Cost[];
  totals: CarMoneyTotals;
  /** Every purchase, sale and cost ever recorded, cancelled and removed ones too: for the Log. */
  historyIds: { purchaseIds: string[]; saleIds: string[]; costIds: string[] };
}

/** A car's Costs tab, within the signed-in User's Operator. */
export async function loadCarCosts(
  database: AnyDatabase,
  operatorId: string,
  vehicleId: string,
): Promise<CarCosts> {
  return withTenant(database, operatorId, async (tx) => {
    const ofCar = <
      Table extends typeof vehicleCosts | typeof vehicleSales | typeof vehiclePurchases,
    >(
      table: Table,
    ) => and(eq(table.operatorId, operatorId), eq(table.vehicleId, vehicleId));
    const [purchases, sales, costs, purchaseReadings] = await Promise.all([
      tx.select().from(vehiclePurchases).where(ofCar(vehiclePurchases)),
      tx.select().from(vehicleSales).where(ofCar(vehicleSales)).orderBy(desc(vehicleSales.soldAt)),
      tx
        .select()
        .from(vehicleCosts)
        .where(ofCar(vehicleCosts))
        .orderBy(desc(vehicleCosts.incurredOn), desc(vehicleCosts.createdAt)),
      tx
        .select({ kilometres: odometerReadings.kilometres })
        .from(odometerReadings)
        .where(
          and(
            eq(odometerReadings.operatorId, operatorId),
            eq(odometerReadings.vehicleId, vehicleId),
            eq(odometerReadings.source, "purchase"),
            isNull(odometerReadings.withdrawnAt),
          ),
        ),
    ]);
    const purchase = purchases[0] ?? null;
    const sale = sales.find((each) => each.cancelledAt === null) ?? null;
    const currentCosts = costs.filter((cost) => cost.archivedAt === null);
    return {
      purchase,
      purchaseKilometres: purchaseReadings[0]?.kilometres ?? null,
      sale,
      costs: currentCosts,
      totals: carMoneyTotals({
        purchase: purchase && { amountCents: purchase.priceCents, gstCents: purchase.gstCents },
        costs: currentCosts.map((cost) => ({
          kind: cost.kind,
          amountCents: cost.costCents,
          gstCents: cost.gstCents,
        })),
        sale: sale && { amountCents: sale.priceCents, gstCents: sale.gstCents },
      }),
      historyIds: {
        purchaseIds: purchases.map((each) => each.id),
        saleIds: sales.map((each) => each.id),
        costIds: costs.map((each) => each.id),
      },
    };
  });
}
