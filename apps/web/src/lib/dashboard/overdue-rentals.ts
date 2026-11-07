import { overdueOf, type Overdue } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { rentals, renters, vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, ne } from "drizzle-orm";

import { selectLinesByRental } from "../ledger/rental-balances";
import { CAR_OF_RENTAL, RENTER_OF_RENTAL } from "../rentals/rental-queries";
import type { FewOfMany } from "./fleet-overview";

/** A rental whose Renter still owes money past its grace days. */
export interface OverdueRental {
  rentalId: string;
  renterId: string;
  renterFullName: string;
  vehicleId: string;
  rego: string;
  overdue: Overdue;
}

/** The longest late first, then a steady order. */
function longestLateFirst(
  first: { rentalId: string; overdue: Overdue },
  second: { rentalId: string; overdue: Overdue },
): number {
  return (
    first.overdue.oldestDueOn.localeCompare(second.overdue.oldestDueOn) ||
    first.rentalId.localeCompare(second.rentalId)
  );
}

/**
 * The Operator's rentals (any but cancelled) with money overdue on `today`
 * (their own calendar day) after `graceDays`, longest late first: the first
 * `limit` of them, and how many there are. Every rental's lines are read in
 * one query and each is worked out by `overdueOf` from its own lines
 * (rule 11), inside the Operator's tenant context (rules 1 and 2). Read only.
 *
 * TODO(Phase 4 slice 5): a failed direct debit makes its rental overdue at
 * once, and money still on its way by debit is not overdue; both plug in
 * through `overdueOf`.
 */
export async function loadOverdueRentals(
  database: AnyDatabase,
  operatorId: string,
  request: { today: string; graceDays: number; limit: number },
): Promise<FewOfMany<OverdueRental>> {
  return withTenant(database, operatorId, async (tx) => {
    const linesByRental = await selectLinesByRental(
      tx,
      operatorId,
      ne(rentals.status, "cancelled"),
    );
    const overdueRentals = [...linesByRental]
      .flatMap(([rentalId, lines]) => {
        const overdue = overdueOf(lines, request.today, request.graceDays);
        return overdue ? [{ rentalId, overdue }] : [];
      })
      .sort(longestLateFirst);
    const shown = overdueRentals.slice(0, request.limit);
    if (shown.length === 0) {
      return { total: overdueRentals.length, items: [] };
    }
    const details = await tx
      .select({
        rentalId: rentals.id,
        renterId: rentals.renterId,
        renterFullName: renters.fullName,
        vehicleId: rentals.vehicleId,
        rego: vehicles.rego,
      })
      .from(rentals)
      .innerJoin(renters, RENTER_OF_RENTAL)
      .innerJoin(vehicles, CAR_OF_RENTAL)
      .where(
        and(
          eq(rentals.operatorId, operatorId),
          inArray(
            rentals.id,
            shown.map((rental) => rental.rentalId),
          ),
        ),
      );
    const detailsById = new Map(details.map((row) => [row.rentalId, row]));
    const items = shown.flatMap(({ rentalId, overdue }) => {
      const rental = detailsById.get(rentalId);
      return rental ? [{ ...rental, overdue }] : [];
    });
    return { total: overdueRentals.length, items };
  });
}
