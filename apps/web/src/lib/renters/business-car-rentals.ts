import type { AnyDatabase } from "@fleetapp/db/client";
import { ledgerLines, rentals } from "@fleetapp/db/schema";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import { MOST_OF_A_KIND } from "../dashboard/fleet-overview";
import { listRentalSummaries, type RentalSummary } from "../rentals/rental-queries";
import type { RentalClock } from "../rentals/rental-records";

/** A car booked or out is always on the business's page, at nought if nothing is charged yet. */
const CURRENT_STATUSES = ["booked", "active"] as const;

export interface BusinessCarRentals {
  /** Its cars booked or out first, then the rest newest first. */
  rentals: RentalSummary[];
  /**
   * More rentals with money on them than the page lists: the oldest finished
   * ones are left out of "car by car", though the totals still count them.
   */
  isCut: boolean;
}

/**
 * The business's rentals that its money car by car shows: every one booked
 * or out, and every one with a money line (rule 11), up to `limit`. Rentals
 * with neither show nothing, so are never loaded and never crowd out one
 * that does.
 */
export async function listBusinessCarRentals(
  database: AnyDatabase,
  operatorId: string,
  organisationId: string,
  clock: RentalClock,
  limit = MOST_OF_A_KIND,
): Promise<BusinessCarRentals> {
  const isCurrent = inArray(rentals.status, [...CURRENT_STATUSES]);
  const hasMoney = sql`exists (select 1 from ${ledgerLines} where ${ledgerLines.operatorId} = ${operatorId} and ${ledgerLines.rentalId} = ${rentals.id})`;
  // One over the limit, so a cut can be told apart from exactly enough.
  const found = await listRentalSummaries(database, operatorId, {
    where: and(eq(rentals.renterId, organisationId), or(isCurrent, hasMoney)),
    clock,
    limit: limit + 1,
    orderBy: [desc(sql`${isCurrent}`), desc(rentals.plannedStart)],
  });
  return { rentals: found.slice(0, limit), isCut: found.length > limit };
}
