import type { AnyDatabase } from "@fleetapp/db/client";
import { rentals } from "@fleetapp/db/schema";
import { and, inArray, or } from "drizzle-orm";

import { MOST_OF_A_KIND } from "../dashboard/fleet-overview";
import { listRentalSummaries, type RentalSummary } from "../rentals/rental-queries";
import type { RentalClock } from "../rentals/rental-records";

/** Out or booked: what a Renter's list row and page say they are doing. */
const UNDER_WAY = ["active", "booked"] as const;

/**
 * Each of these Renters' rentals out or booked, soonest start first: those
 * they rent, and for a driver those of a business they drive. One query for
 * a page of Renters, only the Operator's own (rules 1 and 2).
 */
export async function loadRenterRentalsUnderWay(
  database: AnyDatabase,
  operatorId: string,
  renterIds: readonly string[],
  clock: RentalClock,
): Promise<Map<string, RentalSummary[]>> {
  if (renterIds.length === 0) {
    return new Map();
  }
  const summaries = await listRentalSummaries(database, operatorId, {
    where: and(
      or(inArray(rentals.renterId, [...renterIds]), inArray(rentals.driverId, [...renterIds])),
      inArray(rentals.status, [...UNDER_WAY]),
    ),
    clock,
    limit: MOST_OF_A_KIND,
  });
  const asked = new Set(renterIds);
  const byRenter = new Map<string, RentalSummary[]>();
  for (const rental of summaries) {
    // A person's own rental names them twice; a business's names the business and its driver.
    const parties = new Set([rental.renterId, rental.driverId ?? rental.renterId]);
    for (const renterId of [...parties].filter((party) => asked.has(party))) {
      const renterRentals = byRenter.get(renterId);
      if (renterRentals) {
        renterRentals.push(rental);
      } else {
        byRenter.set(renterId, [rental]);
      }
    }
  }
  return byRenter;
}
