import { bondHeldCents } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { bondMovements, rentals, renters, vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, exists, inArray } from "drizzle-orm";

import { DASHBOARD_LIST_LENGTH, type FewOfMany } from "./fleet-overview";

/** A cancelled booking still holding bond: money owed back to the Renter. */
export interface BondToRefund {
  rentalId: string;
  renterId: string;
  vehicleId: string;
  rego: string;
  renterName: string;
  heldCents: number;
  /** Every booking here is cancelled; the longest waiting for its refund comes first. */
  cancelledAt: Date;
}

/**
 * Cancelled bookings still holding bond, such as a bank debit that cleared
 * after the booking was cancelled (review A5-8). Only bookings with bond
 * entries are read, so the list stays small.
 */
export async function loadBondsToRefund(
  database: AnyDatabase,
  operatorId: string,
  limit = DASHBOARD_LIST_LENGTH,
): Promise<FewOfMany<BondToRefund>> {
  return withTenant(database, operatorId, async (tx) => {
    const cancelled = await tx
      .select({
        rentalId: rentals.id,
        renterId: rentals.renterId,
        vehicleId: rentals.vehicleId,
        rego: vehicles.rego,
        renterName: renters.fullName,
        cancelledAt: rentals.cancelledAt,
      })
      .from(rentals)
      .innerJoin(vehicles, eq(vehicles.id, rentals.vehicleId))
      .innerJoin(renters, eq(renters.id, rentals.renterId))
      .where(
        and(
          eq(rentals.operatorId, operatorId),
          eq(rentals.status, "cancelled"),
          exists(
            tx
              .select({ id: bondMovements.id })
              .from(bondMovements)
              .where(
                and(
                  eq(bondMovements.operatorId, operatorId),
                  eq(bondMovements.rentalId, rentals.id),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(rentals.cancelledAt), asc(rentals.id));
    if (cancelled.length === 0) {
      return { total: 0, items: [] };
    }
    const movements = await tx
      .select({
        id: bondMovements.id,
        rentalId: bondMovements.rentalId,
        kind: bondMovements.kind,
        amountCents: bondMovements.amountCents,
        reversesId: bondMovements.reversesId,
      })
      .from(bondMovements)
      .where(
        and(
          eq(bondMovements.operatorId, operatorId),
          inArray(
            bondMovements.rentalId,
            cancelled.map((rental) => rental.rentalId),
          ),
        ),
      );
    const owed = cancelled
      // A cancelled booking always has its cancelled time (the rentals_cancelled check).
      .flatMap((rental) =>
        rental.cancelledAt ? [{ ...rental, cancelledAt: rental.cancelledAt }] : [],
      )
      .map((rental) => ({
        ...rental,
        heldCents: bondHeldCents(movements.filter((entry) => entry.rentalId === rental.rentalId)),
      }))
      .filter((rental) => rental.heldCents > 0);
    return { total: owed.length, items: owed.slice(0, limit) };
  });
}
