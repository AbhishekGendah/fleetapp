import type { AnyTransaction } from "@fleetapp/db/client";
import { rentals, renters } from "@fleetapp/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";

/** Whether the rental's Renter is archived, so no link may be sent to them (review A3-13). */
export async function isRentalRenterArchived(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<boolean> {
  const [renter] = await tx
    .select({ id: renters.id })
    .from(rentals)
    .innerJoin(
      renters,
      and(eq(renters.id, rentals.renterId), eq(renters.operatorId, rentals.operatorId)),
    )
    .where(
      and(
        eq(rentals.id, rentalId),
        eq(rentals.operatorId, operatorId),
        isNotNull(renters.archivedAt),
      ),
    );
  return renter !== undefined;
}

export const RENTER_ARCHIVED_MESSAGE =
  "This Renter is archived, so no link can be sent. Restore them on their page first.";
