import type { AnyDatabase } from "@fleetapp/db/client";
import { rentals } from "@fleetapp/db/schema";
import { and, inArray } from "drizzle-orm";

import { MOST_OF_A_KIND } from "../dashboard/fleet-overview";
import { listRentalSummaries, type RentalSummary } from "../rentals/rental-queries";
import type { RentalClock } from "../rentals/rental-records";

/** Out or booked: what a Renter's list row and page say they are doing. */
const UNDER_WAY = ["active", "booked"] as const;

/**
 * Each of these Renters' rentals out or booked, soonest start first: one
 * query for a page of Renters, only the Operator's own (rules 1 and 2).
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
    where: and(inArray(rentals.renterId, [...renterIds]), inArray(rentals.status, [...UNDER_WAY])),
    clock,
    limit: MOST_OF_A_KIND,
  });
  const byRenter = new Map<string, RentalSummary[]>();
  for (const rental of summaries) {
    const renterRentals = byRenter.get(rental.renterId);
    if (renterRentals) {
      renterRentals.push(rental);
    } else {
      byRenter.set(rental.renterId, [rental]);
    }
  }
  return byRenter;
}
