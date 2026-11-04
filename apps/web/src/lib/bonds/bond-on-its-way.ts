import type { AnyTransaction } from "@fleetapp/db/client";
import { payments } from "@fleetapp/db/schema";
import { and, eq, sum } from "drizzle-orm";

import { unrecordedBondCents } from "../payments/stripe-checkouts";

/**
 * Bond paid through Stripe that hasn't arrived yet: bank debits still
 * clearing, and finished Stripe pages not recorded yet. Named wherever the
 * bond is shown, never counted as held (review A5-2).
 */
export async function bondOnItsWayCents(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<number> {
  const [[pending], unrecordedCents] = await Promise.all([
    tx
      .select({ cents: sum(payments.amountCents).mapWith(Number) })
      .from(payments)
      .where(
        and(
          eq(payments.operatorId, operatorId),
          eq(payments.rentalId, rentalId),
          eq(payments.purpose, "bond"),
          eq(payments.status, "pending"),
        ),
      ),
    unrecordedBondCents(tx, operatorId, rentalId),
  ]);
  return (pending?.cents ?? 0) + unrecordedCents;
}
