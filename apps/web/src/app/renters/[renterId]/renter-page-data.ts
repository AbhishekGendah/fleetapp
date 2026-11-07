import { expiryStatus, todayInTimeZone, type ExpiryStatus, type Overdue } from "@fleetapp/core";

import { appDb } from "../../../lib/app-db";
import { loadBondsToRefund } from "../../../lib/dashboard/bonds-to-refund";
import { MOST_OF_A_KIND } from "../../../lib/dashboard/fleet-overview";
import { loadRenterLedger, type LedgerView } from "../../../lib/ledger/ledger-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import type { SignedInUser } from "../../../lib/require-user";
import {
  renterListRows,
  rentingOf,
  type RenterRenting,
} from "../../../lib/renters/renter-list-rows";
import { renterOverdueOf, type RenterBadge } from "../../../lib/renters/renter-list-status";
import {
  countRenterRentals,
  loadRenterSummary,
  type RenterDetail,
} from "../../../lib/renters/renter-queries";
import { loadRenterRentalsUnderWay } from "../../../lib/renters/renter-rentals-now";
import type { RentalSummary } from "../../../lib/rentals/rental-queries";
import { loadOperatorSettings } from "../../../lib/settings/operator-settings";
import type { ExpiryContext } from "../../../lib/vehicles/expiry-columns";
import { loadExpiryContext } from "../../../lib/vehicles/expiry-context";

/** What the strip and the Overview show beyond the Renter themselves, loaded once for the page. */
export interface RenterPageData {
  /** Every line of every rental of theirs, and the balance added up from them (rule 11). */
  ledger: LedgerView;
  overdue: Overdue | null;
  /** Their rentals out or booked, soonest first. */
  rentalsUnderWay: RentalSummary[];
  renting: RenterRenting;
  rentalCount: number;
  badges: RenterBadge[];
  licenceExpiry: ExpiryContext;
  licenceStatus: ExpiryStatus;
  today: string;
}

export async function loadRenterPageData(
  renter: RenterDetail,
  user: SignedInUser,
  clock: RentalClock,
): Promise<RenterPageData> {
  const today = todayInTimeZone(clock.now, clock.timeZone);
  const [summary, ledger, underWay, rentalCount, licenceExpiry, settings, bonds] =
    await Promise.all([
      loadRenterSummary(appDb, user.operatorId, renter.id),
      loadRenterLedger(appDb, user.operatorId, renter.id),
      loadRenterRentalsUnderWay(appDb, user.operatorId, [renter.id], clock),
      countRenterRentals(appDb, user.operatorId, renter.id),
      loadExpiryContext(user, "licenceExpiryWarningDays"),
      loadOperatorSettings(appDb, user.operatorId),
      loadBondsToRefund(appDb, user.operatorId, MOST_OF_A_KIND),
    ]);
  if (!summary) {
    throw new Error("The Renter went missing while their page loaded.");
  }
  const rentalsUnderWay = underWay.get(renter.id) ?? [];
  const overdue = renterOverdueOf(ledger.lines, today, settings.paymentGraceDays);
  // The same words and labels as their row on the Renters list.
  const [row] = renterListRows(
    [summary],
    {
      rentalsUnderWay: underWay,
      money: new Map([[renter.id, { balanceCents: ledger.balanceCents, overdue }]]),
      bondToRefundRenterIds: new Set(bonds.items.map((bond) => bond.renterId)),
    },
    licenceExpiry,
    clock,
  );
  return {
    ledger,
    overdue,
    rentalsUnderWay,
    renting: row?.renting ?? rentingOf(summary, rentalsUnderWay, clock),
    rentalCount,
    badges: row?.badges ?? [],
    licenceExpiry,
    licenceStatus: expiryStatus(
      renter.licenceExpiresOn,
      licenceExpiry.today,
      licenceExpiry.warningDays,
    ),
    today,
  };
}
