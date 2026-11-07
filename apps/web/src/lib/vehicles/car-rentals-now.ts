import type { AnyDatabase } from "@fleetapp/db/client";
import { possessions, rentals } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { MOST_OF_A_KIND } from "../dashboard/fleet-overview";
import { listRentalSummaries, type RentalSummary } from "../rentals/rental-queries";
import type { RentalClock } from "../rentals/rental-records";

/** Who has a car now and its next booking. */
export interface CarRentalsNow {
  withRenter: RentalSummary | null;
  nextBooking: RentalSummary | null;
}

/**
 * For each of these cars: the rental whose Renter has it now (their
 * possession is still open, rule 15, so a car swapped away mid-rental is
 * still with them until it is back) and its next booking. Two queries for a
 * whole page of cars, only the Operator's own (rules 1 and 2).
 */
export async function loadCarRentalsNow(
  database: AnyDatabase,
  operatorId: string,
  vehicleIds: readonly string[],
  clock: RentalClock,
): Promise<Map<string, CarRentalsNow>> {
  if (vehicleIds.length === 0) {
    return new Map();
  }
  const open = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ vehicleId: possessions.vehicleId, rentalId: possessions.rentalId })
      .from(possessions)
      .where(
        and(
          eq(possessions.operatorId, operatorId),
          inArray(possessions.vehicleId, [...vehicleIds]),
          isNull(possessions.endedAt),
        ),
      ),
  );
  const summaries = await listRentalSummaries(database, operatorId, {
    where: or(
      open.length > 0
        ? inArray(
            rentals.id,
            open.map((possession) => possession.rentalId),
          )
        : undefined,
      and(inArray(rentals.vehicleId, [...vehicleIds]), eq(rentals.status, "booked")),
    ),
    clock,
    limit: MOST_OF_A_KIND,
  });
  const byId = new Map(summaries.map((rental) => [rental.id, rental]));
  const byCar = new Map<string, CarRentalsNow>(
    vehicleIds.map((vehicleId) => [vehicleId, { withRenter: null, nextBooking: null }]),
  );
  for (const possession of open) {
    const rental = byId.get(possession.rentalId);
    const car = byCar.get(possession.vehicleId);
    if (rental && car) {
      byCar.set(possession.vehicleId, { ...car, withRenter: rental });
    }
  }
  // Soonest start first, so the first booking met for a car is its next.
  for (const rental of summaries) {
    const car = byCar.get(rental.vehicleId);
    if (rental.status === "booked" && car && !car.nextBooking) {
      byCar.set(rental.vehicleId, { ...car, nextBooking: rental });
    }
  }
  return byCar;
}
