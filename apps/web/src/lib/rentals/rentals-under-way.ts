import { RENTAL_STATUSES, isHoldingCar } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { carHolds, possessions, rentals } from "@fleetapp/db/schema";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

/** Booked or out: a rental still holding its car. */
const STATUSES_UNDER_WAY = RENTAL_STATUSES.filter(isHoldingCar);

/** Whether this Renter has a rental booked or out (review A8-1), as the Renter or its driver. */
export async function hasRenterRentalUnderWay(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<boolean> {
  const [rental] = await tx
    .select({ id: rentals.id })
    .from(rentals)
    .where(
      and(
        eq(rentals.operatorId, operatorId),
        or(eq(rentals.renterId, renterId), eq(rentals.driverId, renterId)),
        inArray(rentals.status, STATUSES_UNDER_WAY),
      ),
    )
    .limit(1);
  return rental !== undefined;
}

/**
 * Whether this car is booked or out (review A8-1): a rental on it, a hold on
 * it, or a Renter still with it (as after a swap, until it is returned).
 */
export async function hasCarRentalUnderWay(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
): Promise<boolean> {
  const [rental] = await tx
    .select({ id: rentals.id })
    .from(rentals)
    .where(
      and(
        eq(rentals.operatorId, operatorId),
        eq(rentals.vehicleId, vehicleId),
        inArray(rentals.status, STATUSES_UNDER_WAY),
      ),
    )
    .limit(1);
  if (rental) {
    return true;
  }
  const [hold] = await tx
    .select({ id: carHolds.id })
    .from(carHolds)
    .where(
      and(
        eq(carHolds.operatorId, operatorId),
        eq(carHolds.vehicleId, vehicleId),
        isNull(carHolds.releasedAt),
      ),
    )
    .limit(1);
  if (hold) {
    return true;
  }
  const [possession] = await tx
    .select({ id: possessions.id })
    .from(possessions)
    .where(
      and(
        eq(possessions.operatorId, operatorId),
        eq(possessions.vehicleId, vehicleId),
        isNull(possessions.endedAt),
      ),
    )
    .limit(1);
  return possession !== undefined;
}
