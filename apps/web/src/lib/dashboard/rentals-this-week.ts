import {
  MOMENTS_BEFORE_HANDOVER,
  RENTAL_MOMENTS,
  rentalMomentOf,
  type BookingProblem,
  type DashboardWindow,
  type RentalMoment,
} from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { rentals } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, lt, or } from "drizzle-orm";

import { loadSigningStatus } from "../contracts/signing-links";
import { loadRentalProblems, type PaymentsReach } from "../rentals/booking-checks";
import { listRentalSummaries, type RentalSummary } from "../rentals/rental-queries";
import type { RentalClock } from "../rentals/rental-records";

/**
 * More than any fleet has changing in one week; the dashboard never loads
 * every rental, only those with something happening.
 */
const MOST_RENTALS_THIS_WEEK = 300;

export interface RentalThisWeek extends RentalSummary {
  moment: RentalMoment;
}

/** What still stops a booking being handed over: the rental page's problems, plus the contract. */
export type HandoverBlocker = BookingProblem | { code: "contract_unsigned" };

export interface BookingReadiness {
  rentalId: string;
  blockers: HandoverBlocker[];
}

/**
 * Every booked or active rental with something happening this week, most
 * urgent first: overdue, late pickups, then today, then the rest of the week.
 */
export async function loadRentalsThisWeek(
  database: AnyDatabase,
  operatorId: string,
  window: DashboardWindow,
  clock: RentalClock,
): Promise<RentalThisWeek[]> {
  const candidates = await listRentalSummaries(database, operatorId, {
    where: or(
      and(eq(rentals.status, "active"), lt(rentals.plannedEnd, window.weekEnds)),
      and(eq(rentals.status, "booked"), lt(rentals.plannedStart, window.weekEnds)),
    ),
    clock,
    limit: MOST_RENTALS_THIS_WEEK,
  });
  return candidates
    .flatMap((rental) => {
      const moment = rentalMomentOf(rental, window);
      return moment ? [{ ...rental, moment }] : [];
    })
    .sort(
      (first, second) =>
        RENTAL_MOMENTS.indexOf(first.moment) - RENTAL_MOMENTS.indexOf(second.moment),
    );
}

/**
 * For each booking about to be handed over, what still stands in the way,
 * checked as the rental's own page does (under the rules it was made with).
 * Only bookings with a blocker are returned.
 */
export async function loadBookingReadiness(
  database: AnyDatabase,
  operatorId: string,
  thisWeek: readonly RentalThisWeek[],
  clock: RentalClock,
  reach?: PaymentsReach,
): Promise<BookingReadiness[]> {
  const bookingIds = thisWeek
    .filter((rental) => MOMENTS_BEFORE_HANDOVER.includes(rental.moment))
    .map((rental) => rental.id);
  if (bookingIds.length === 0) {
    return [];
  }
  const bookings = await withTenant(database, operatorId, (tx) =>
    tx
      .select()
      .from(rentals)
      .where(and(eq(rentals.operatorId, operatorId), inArray(rentals.id, bookingIds))),
  );
  const readiness = await Promise.all(
    bookings.map(async (booking): Promise<BookingReadiness> => {
      const [problems, signing] = await Promise.all([
        loadRentalProblems(database, operatorId, booking, clock, reach),
        loadSigningStatus(database, operatorId, booking.id, clock.now),
      ]);
      const handoverProblems =
        typeof problems === "string"
          ? []
          : problems.filter((problem) => problem.level === "handover");
      const blockers: HandoverBlocker[] = signing.signed
        ? handoverProblems
        : [{ code: "contract_unsigned" }, ...handoverProblems];
      return { rentalId: booking.id, blockers };
    }),
  );
  return readiness.filter((booking) => booking.blockers.length > 0);
}
