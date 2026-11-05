import type { AnyTransaction } from "@fleetapp/db/client";
import { rentals } from "@fleetapp/db/schema";
import { and, eq, inArray, isNotNull, max } from "drizzle-orm";

import type { RetentionHolds } from "../renters/scan-retention";

/**
 * Rentals that still need the Renter's licence: a booking, or a car that is
 * out. A returned or cancelled rental has ended, and a draft was never
 * agreed, so neither keeps the scans for ever (review G8-5). Fines and
 * disputes add their own holds when they come.
 */
const OPEN_RENTAL_STATUSES = ["booked", "active"] as const;

/**
 * When each Renter's last rental came back, for the scan timer to count
 * from. A cancelled booking never had the car out, so it doesn't restart the
 * timer: the scan is kept from when it was added, as for a Renter who never rented.
 */
async function lastRentalEnds(
  tx: AnyTransaction,
  operatorId: string,
  renterIds: readonly string[],
): Promise<Map<string, Date>> {
  if (renterIds.length === 0) {
    return new Map();
  }
  const rows = await tx
    .select({ renterId: rentals.renterId, lastReturnedAt: max(rentals.returnedAt) })
    .from(rentals)
    // Named, not left to row-level security alone (rule 1, review G8-9).
    .where(
      and(
        eq(rentals.operatorId, operatorId),
        inArray(rentals.renterId, [...renterIds]),
        isNotNull(rentals.returnedAt),
      ),
    )
    .groupBy(rentals.renterId);
  return new Map(
    rows.flatMap((row) => (row.lastReturnedAt ? [[row.renterId, row.lastReturnedAt]] : [])),
  );
}

/** Renters with a booking, or a car out. */
async function rentersWithOpenRentals(
  tx: AnyTransaction,
  operatorId: string,
  renterIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (renterIds.length === 0) {
    return new Set();
  }
  const rows = await tx
    .selectDistinct({ renterId: rentals.renterId })
    .from(rentals)
    .where(
      and(
        eq(rentals.operatorId, operatorId),
        inArray(rentals.renterId, [...renterIds]),
        inArray(rentals.status, [...OPEN_RENTAL_STATUSES]),
      ),
    );
  return new Set(rows.map((row) => row.renterId));
}

/**
 * What rentals hold back from the licence scan clean-up (APP 11.2: kept
 * only while needed). Fines and disputes add theirs in Phase 4.
 */
export const RENTAL_RETENTION_HOLDS: RetentionHolds = {
  lastRentalEnds,
  rentersWithOpenMatters: rentersWithOpenRentals,
};
