import {
  expiryStatus,
  formatMonthYearInTimeZone,
  formatShortDayInTimeZone,
  renterShownName,
  RENTER_KIND_LABELS,
  todayInTimeZone,
  type ExpiryStatus,
} from "@fleetapp/core";

import type { RentalSummary } from "../rentals/rental-queries";
import type { RentalClock } from "../rentals/rental-records";
import { rentalWhenWords } from "../rentals/rental-when";
import type { ExpiryContext } from "../vehicles/expiry-columns";
import type { RenterMoney } from "./renter-money";
import { renterBadges, type RenterBadge } from "./renter-list-status";
import { midSentence } from "./renter-page-facts";
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
  /** A business by its trading name; a person by their name (and the one they go by). */
  shownName: string;
  /** What the Renter is, beside their name: "Business", "Driver for Acme Rides". None for a person on their own. */
  kindLabels: string[];
  licenceStatus: ExpiryStatus;
  badges: RenterBadge[];
  renting: RenterRenting;
  /** From the ledger (rule 11); none when nothing has been charged or paid yet. */
  balanceCents: number | null;
  /** A driver with nothing of their own to pay, in a business's car: the business, "Acme Rides". */
  paidByName: string | null;
  /** The same, in words: "Acme Rides pays". */
  paidByText: string | null;
  /** "Mar 2026": when they were added. */
  sinceText: string;
};

/** What the list loads beside the Renters themselves, for one page of them. */
export interface RenterListExtras {
  /** Each Renter's rentals out or booked, soonest first. */
  rentalsUnderWay: ReadonlyMap<string, readonly RentalSummary[]>;
  money: ReadonlyMap<string, RenterMoney>;
  bondToRefundRenterIds: ReadonlySet<string>;
  /** The businesses each driver drives for now. */
  businessesOf: ReadonlyMap<string, readonly { id: string; name: string }[]>;
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

/** "3 cars out", with "1 booked, starts Mon 9 Nov" after it when there is a booking too. */
function carsOutWords(
  carsOut: number,
  booked: readonly RentalSummary[],
  clock: RentalClock,
): string {
  const [next] = booked;
  if (!next) {
    return `${carsOut} cars out`;
  }
  return `${carsOut} cars out · ${booked.length} booked, ${midSentence(rentalWhenWords(next, clock).shortText)}`;
}

/**
 * What a business is renting: with two or more cars out, how many (each car
 * is on its own row of its Rentals tab); otherwise as for a person.
 */
export function businessRentingOf(
  renter: Pick<RenterSummary, "lastBackAt">,
  underWay: readonly RentalSummary[],
  clock: RentalClock,
): RenterRenting {
  const carsOut = underWay.filter((rental) => rental.status === "active").length;
  if (carsOut < 2) {
    return rentingOf(renter, underWay, clock);
  }
  const words = carsOutWords(
    carsOut,
    underWay.filter((rental) => rental.status === "booked"),
    clock,
  );
  return { rental: null, words, shortWords: words };
}

/** The business that pays for the car a driver has, when it is not their own rental. */
function paidByNameOf(
  renterId: string,
  renting: RenterRenting,
  hasOwnMoney: boolean,
): string | null {
  const { rental } = renting;
  if (hasOwnMoney || !rental || rental.renterId === renterId) {
    return null;
  }
  return renterShownName({
    kind: rental.renterKind,
    fullName: rental.renterFullName,
    preferredName: rental.renterPreferredName,
    tradingName: rental.renterTradingName,
  });
}

function kindLabelsOf(renter: RenterSummary, extras: RenterListExtras): string[] {
  if (renter.kind === "organisation") {
    return [RENTER_KIND_LABELS.organisation];
  }
  return (extras.businessesOf.get(renter.id) ?? []).map(
    (business) => `Driver for ${business.name}`,
  );
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
    const renting =
      renter.kind === "organisation"
        ? businessRentingOf(renter, underWay, clock)
        : rentingOf(renter, underWay, clock);
    const paidByName = paidByNameOf(renter.id, renting, money !== undefined);
    return {
      ...renter,
      shownName: renterShownName(renter),
      kindLabels: kindLabelsOf(renter, extras),
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
      renting,
      balanceCents: money?.balanceCents ?? null,
      paidByName,
      paidByText: paidByName ? `${paidByName} pays` : null,
      sinceText: formatMonthYearInTimeZone(renter.createdAt, clock.timeZone),
    };
  });
}
