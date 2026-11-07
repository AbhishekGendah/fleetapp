import {
  expiryStatus,
  formatMonthYearInTimeZone,
  formatShortDayInTimeZone,
  todayInTimeZone,
  type ExpiryStatus,
} from "@fleetapp/core";

import type { RentalSummary } from "../rentals/rental-queries";
import type { RentalClock } from "../rentals/rental-records";
import { rentalWhenWords } from "../rentals/rental-when";
import type { ExpiryContext } from "../vehicles/expiry-columns";
import type { RenterMoney } from "./renter-money";
import { renterBadges, type RenterBadge } from "./renter-list-status";
import type { RenterSummary } from "./renter-queries";

/** The rental a Renter has now (or their next booking), and its When in words. */
export interface RenterRenting {
  rental: RentalSummary | null;
  /** "Back today 3:30 pm", "Since Fri 2 Oct, ongoing"; or "Last back Tue 29 Sep", "No rentals yet". */
  words: string;
  /** A phone card's shorter words for a rental out: "Back Tue 10 Nov". */
  shortWords: string;
}

export type RenterListRow = RenterSummary & {
  licenceStatus: ExpiryStatus;
  badges: RenterBadge[];
  renting: RenterRenting;
  /** From the ledger (rule 11); none when nothing has been charged or paid yet. */
  balanceCents: number | null;
  /** "Mar 2026": when they were added. */
  sinceText: string;
};

/** What the list loads beside the Renters themselves, for one page of them. */
export interface RenterListExtras {
  /** Each Renter's rentals out or booked, soonest first. */
  rentalsUnderWay: ReadonlyMap<string, readonly RentalSummary[]>;
  money: ReadonlyMap<string, RenterMoney>;
  bondToRefundRenterIds: ReadonlySet<string>;
}

const NO_RENTALS = "No rentals yet";

/** The rental out first, else the next booking; or when they last had a car back. */
export function rentingOf(
  renter: Pick<RenterSummary, "lastBackAt">,
  underWay: readonly RentalSummary[],
  clock: RentalClock,
): RenterRenting {
  const rental = underWay.find((one) => one.status === "active") ?? underWay[0] ?? null;
  if (rental) {
    const when = rentalWhenWords(rental, clock);
    return { rental, words: when.text, shortWords: when.shortText };
  }
  if (!renter.lastBackAt) {
    return { rental: null, words: NO_RENTALS, shortWords: NO_RENTALS };
  }
  const today = todayInTimeZone(clock.now, clock.timeZone);
  const words = `Last back ${formatShortDayInTimeZone(renter.lastBackAt, clock.timeZone, today)}`;
  return { rental: null, words, shortWords: words };
}

/** The Renters list's rows as the screen and the exports show them, on the Operator's clock. */
export function renterListRows(
  renters: readonly RenterSummary[],
  extras: RenterListExtras,
  licenceExpiry: ExpiryContext,
  clock: RentalClock,
): RenterListRow[] {
  return renters.map((renter) => {
    const underWay = extras.rentalsUnderWay.get(renter.id) ?? [];
    const money = extras.money.get(renter.id);
    const licenceStatus = expiryStatus(
      renter.licenceExpiresOn,
      licenceExpiry.today,
      licenceExpiry.warningDays,
    );
    return {
      ...renter,
      licenceStatus,
      badges: renterBadges({
        status: renter.status,
        isArchived: renter.archivedAt !== null,
        isRentingNow: underWay.some((rental) => rental.status === "active"),
        isBooked: underWay.some((rental) => rental.status === "booked"),
        isWaitingReview: renter.isWaitingReview,
        licenceStatus,
        isOverdue: Boolean(money?.overdue),
        isBondToRefund: extras.bondToRefundRenterIds.has(renter.id),
      }),
      renting: rentingOf(renter, underWay, clock),
      balanceCents: money?.balanceCents ?? null,
      sinceText: formatMonthYearInTimeZone(renter.createdAt, clock.timeZone),
    };
  });
}
