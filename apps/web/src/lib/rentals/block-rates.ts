import type { BlockRate } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { rentalRates } from "@fleetapp/db/schema";
import { and, eq } from "drizzle-orm";

/** A block rental's rates, each from the block it starts at (weekday-era rows are left out). */
export async function loadBlockRates(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<BlockRate[]> {
  const rows = await tx
    .select({
      fromBlock: rentalRates.appliesFromBlock,
      dailyRateCents: rentalRates.dailyRateCents,
      weeklyRateCents: rentalRates.weeklyRateCents,
    })
    .from(rentalRates)
    .where(and(eq(rentalRates.operatorId, operatorId), eq(rentalRates.rentalId, rentalId)));
  return rows.flatMap(({ fromBlock, dailyRateCents, weeklyRateCents }) =>
    fromBlock !== null && dailyRateCents !== null
      ? [{ fromBlock, dailyRateCents, weeklyRateCents }]
      : [],
  );
}
