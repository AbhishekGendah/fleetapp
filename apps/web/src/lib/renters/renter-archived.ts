import type { RenterKind } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { rentals, renters } from "@fleetapp/db/schema";
import { and, eq } from "drizzle-orm";

/** The rental's Renter as far as its links need to know: their kind, and whether archived. */
export async function rentalRenterStanding(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<{ kind: RenterKind; isArchived: boolean } | null> {
  const [renter] = await tx
    .select({ kind: renters.kind, archivedAt: renters.archivedAt })
    .from(rentals)
    .innerJoin(
      renters,
      and(eq(renters.id, rentals.renterId), eq(renters.operatorId, rentals.operatorId)),
    )
    .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)));
  return renter ? { kind: renter.kind, isArchived: renter.archivedAt !== null } : null;
}

/** Whether the rental's Renter is archived, so no link may be sent to them (review A3-13). */
export async function isRentalRenterArchived(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<boolean> {
  return (await rentalRenterStanding(tx, operatorId, rentalId))?.isArchived ?? false;
}

export const RENTER_ARCHIVED_MESSAGE =
  "This Renter is archived, so no link can be sent. Restore them on their page first.";
