import type { AnyTransaction } from "@fleetapp/db/client";
import { rentalDriverChanges } from "@fleetapp/db/schema";
import { and, eq } from "drizzle-orm";

export type DriverChange = typeof rentalDriverChanges.$inferSelect;

/** The driver change under way for the rental, if any; locked when asked. */
export async function driverChangeUnderWay(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
  shouldLock = false,
): Promise<DriverChange | null> {
  const query = tx
    .select()
    .from(rentalDriverChanges)
    .where(
      and(
        eq(rentalDriverChanges.operatorId, operatorId),
        eq(rentalDriverChanges.rentalId, rentalId),
        eq(rentalDriverChanges.status, "in_progress"),
      ),
    );
  const [change] = shouldLock ? await query.for("update") : await query;
  return change ?? null;
}
