import {
  ledgerTotals,
  type LedgerLineAmount,
  type LedgerTotals,
  type RentalStatus,
} from "@fleetapp/core";

/** One of a business's rentals, as its money across cars names it. */
export interface BusinessRental {
  id: string;
  rego: string;
  vehicleId: string;
  status: RentalStatus;
  driverName: string | null;
}

export type CarMoney = BusinessRental & LedgerTotals;

/**
 * A business's money car by car (docs/plans/business-renters.md, "Money
 * correctness"): each rental's own lines added up by the one ledger rule
 * (rule 11), nothing stored and no new arithmetic. A reversal is always on
 * the same rental as the line it undoes, so each rental nets on its own and
 * the cars' balances add up to the business's. Rentals with no lines yet are
 * shown at nought while booked or out, and left out once finished. Pure.
 */
export function moneyByCar(
  lines: readonly (LedgerLineAmount & { rentalId: string })[],
  rentals: readonly BusinessRental[],
): CarMoney[] {
  const linesByRental = new Map<string, (LedgerLineAmount & { rentalId: string })[]>();
  for (const line of lines) {
    const rentalLines = linesByRental.get(line.rentalId);
    if (rentalLines) {
      rentalLines.push(line);
    } else {
      linesByRental.set(line.rentalId, [line]);
    }
  }
  return rentals
    .filter(
      (rental) =>
        linesByRental.has(rental.id) || rental.status === "active" || rental.status === "booked",
    )
    .map((rental) => ({ ...rental, ...ledgerTotals(linesByRental.get(rental.id) ?? []) }));
}
