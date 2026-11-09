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
import { longestLateRental, type RenterBadge } from "../../../lib/renters/renter-list-status";
import {
  countRenterRentals,
  loadRenterSummary,
  type RenterDetail,
} from "../../../lib/renters/renter-queries";
import { loadCurrentBusinessesOf } from "../../../lib/renters/organisation-driver-queries";
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
  /** The car of their longest-late rental: a business's strip names it. */
  lateRego: string | null;
  /** Their rentals out or booked, soonest first. */
  rentalsUnderWay: RentalSummary[];
  renting: RenterRenting;
  rentalCount: number;
  badges: RenterBadge[];
  /** "Business", "Driver for Acme Rides": as beside their name on the list. */
  kindLabels: string[];
  /** A driver with nothing of their own to pay, in a business's car: "Acme Rides pays". */
  paidByText: string | null;
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
  const [summary, ledger, underWay, rentalCount, licenceExpiry, settings, bonds, businessesOf] =
    await Promise.all([
      loadRenterSummary(appDb, user.operatorId, renter.id),
      loadRenterLedger(appDb, user.operatorId, renter.id),
      loadRenterRentalsUnderWay(appDb, user.operatorId, [renter.id], clock),
      countRenterRentals(appDb, user.operatorId, renter.id),
      loadExpiryContext(user, "licenceExpiryWarningDays"),
      loadOperatorSettings(appDb, user.operatorId),
      loadBondsToRefund(appDb, user.operatorId, MOST_OF_A_KIND),
      loadCurrentBusinessesOf(appDb, user.operatorId, [renter.id]),
    ]);
  if (!summary) {
    throw new Error("The Renter went missing while their page loaded.");
  }
  const rentalsUnderWay = underWay.get(renter.id) ?? [];
  const late = longestLateRental(ledger.lines, today, settings.paymentGraceDays);
  const overdue = late?.overdue ?? null;
  const lateRego =
    ledger.lines.filter((line) => line.rentalId === late?.rentalId).at(-1)?.rego ?? null;
  // The same words and labels as their row on the Renters list.
  const [row] = renterListRows(
    [summary],
    {
      rentalsUnderWay: underWay,
      // No lines of their own reads as no money of their own, as on the list.
      money:
        ledger.lines.length > 0
          ? new Map([
              [
                renter.id,
                {
                  balanceCents: ledger.balanceCents,
                  overdue,
                  rentalCount: new Set(ledger.lines.map((line) => line.rentalId)).size,
                },
              ],
            ])
          : new Map(),
      bondToRefundRenterIds: new Set(bonds.items.map((bond) => bond.renterId)),
      businessesOf,
    },
    licenceExpiry,
    clock,
  );
  return {
    ledger,
    overdue,
    lateRego,
    rentalsUnderWay,
    renting: row?.renting ?? rentingOf(summary, rentalsUnderWay, clock),
    rentalCount,
    badges: row?.badges ?? [],
    kindLabels: row?.kindLabels ?? [],
    paidByText: row?.paidByText ?? null,
    licenceExpiry,
    licenceStatus: expiryStatus(
      renter.licenceExpiresOn,
      licenceExpiry.today,
      licenceExpiry.warningDays,
    ),
    today,
  };
}
