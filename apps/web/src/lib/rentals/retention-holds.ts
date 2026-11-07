import type { AnyTransaction } from "@fleetapp/db/client";
import { possessions, rentals } from "@fleetapp/db/schema";
import { and, eq, inArray, isNotNull, isNull, max } from "drizzle-orm";

import type { RetentionHolds } from "../renters/scan-retention";

/**
 * Rentals that still need the driver's licence (the Renter's own, for a
 * person; the licence is always the driver's): a booking, or a car that is
 * out. A returned or cancelled rental has ended, and a draft was never
 * agreed, so neither keeps the scans for ever (review G8-5). Fines and
 * disputes add their own holds when they come.
 */
const OPEN_RENTAL_STATUSES = ["booked", "active"] as const;

/**
 * When each driver last had a car back, for the scan timer to count from:
 * the return of a rental they drove, or the end of their time with a car (a
 * business's driver may hand a car on before its return). A cancelled
 * booking never had the car out, so it doesn't restart the timer: the scan
 * is kept from when it was added, as for a Renter who never rented.
 */
async function lastRentalEnds(
  tx: AnyTransaction,
  operatorId: string,
  renterIds: readonly string[],
): Promise<Map<string, Date>> {
  if (renterIds.length === 0) {
    return new Map();
  }
  const [returned, handedBack] = await Promise.all([
    tx
      .select({ driverId: rentals.driverId, endedAt: max(rentals.returnedAt) })
      .from(rentals)
      // Named, not left to row-level security alone (rule 1, review G8-9).
      .where(
        and(
          eq(rentals.operatorId, operatorId),
          inArray(rentals.driverId, [...renterIds]),
          isNotNull(rentals.returnedAt),
        ),
      )
      .groupBy(rentals.driverId),
    tx
      .select({ driverId: possessions.driverId, endedAt: max(possessions.endedAt) })
      .from(possessions)
      .where(
        and(
          eq(possessions.operatorId, operatorId),
          inArray(possessions.driverId, [...renterIds]),
          isNotNull(possessions.endedAt),
        ),
      )
      .groupBy(possessions.driverId),
  ]);
  const ends = new Map<string, Date>();
  for (const { driverId, endedAt } of [...returned, ...handedBack]) {
    const known = driverId ? ends.get(driverId) : undefined;
    if (driverId && endedAt && (!known || endedAt > known)) {
      ends.set(driverId, endedAt);
    }
  }
  return ends;
}

/** Drivers with a booking, or a car out. */
async function rentersWithOpenRentals(
  tx: AnyTransaction,
  operatorId: string,
  renterIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (renterIds.length === 0) {
    return new Set();
  }
  const [booked, out] = await Promise.all([
    tx
      .selectDistinct({ driverId: rentals.driverId })
      .from(rentals)
      .where(
        and(
          eq(rentals.operatorId, operatorId),
          inArray(rentals.driverId, [...renterIds]),
          inArray(rentals.status, [...OPEN_RENTAL_STATUSES]),
        ),
      ),
    tx
      .selectDistinct({ driverId: possessions.driverId })
      .from(possessions)
      .where(
        and(
          eq(possessions.operatorId, operatorId),
          inArray(possessions.driverId, [...renterIds]),
          isNull(possessions.endedAt),
        ),
      ),
  ]);
  return new Set([...booked, ...out].flatMap((row) => (row.driverId ? [row.driverId] : [])));
}

/**
 * What rentals hold back from the licence scan clean-up (APP 11.2: kept
 * only while needed). Fines and disputes add theirs in Phase 4.
 */
export const RENTAL_RETENTION_HOLDS: RetentionHolds = {
  lastRentalEnds,
  rentersWithOpenMatters: rentersWithOpenRentals,
};
