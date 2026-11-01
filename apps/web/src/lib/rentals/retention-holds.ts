import type { AnyTransaction } from "@fleetapp/db/client";
import { rentals } from "@fleetapp/db/schema";
import { and, inArray, isNotNull, max } from "drizzle-orm";

import type { RetentionHolds } from "../renters/scan-retention";

/**
 * Rentals not yet closed: still planned, out, or back with the bond, tolls
 * and fines still to settle. A Renter on one keeps their licence scans.
 */
const OPEN_RENTAL_STATUSES = ["draft", "booked", "active", "returned"] as const;

/** When each Renter's last rental came back, for the scan timer to count from. */
async function lastRentalEnds(
  tx: AnyTransaction,
  renterIds: readonly string[],
): Promise<Map<string, Date>> {
  if (renterIds.length === 0) {
    return new Map();
  }
  const rows = await tx
    .select({ renterId: rentals.renterId, lastReturnedAt: max(rentals.returnedAt) })
    .from(rentals)
    .where(and(inArray(rentals.renterId, [...renterIds]), isNotNull(rentals.returnedAt)))
    .groupBy(rentals.renterId);
  return new Map(
    rows.flatMap((row) => (row.lastReturnedAt ? [[row.renterId, row.lastReturnedAt]] : [])),
  );
}

/** Renters with a rental that is not closed yet. */
async function rentersWithOpenRentals(
  tx: AnyTransaction,
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
