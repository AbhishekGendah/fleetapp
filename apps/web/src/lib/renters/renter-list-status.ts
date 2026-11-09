import type { DatedLedgerLine, ExpiryStatus, Overdue, RenterStatus } from "@fleetapp/core";
import { overdueOf } from "@fleetapp/core";
import type { BadgeTone } from "@fleetapp/ui/badge";

/**
 * A Renter's standing in the Operator's plain words (docs/plans/look-and-feel.md,
 * "Cars and Renters pages"): renting, booked or not; then anything that needs
 * a look. The Renters list's filters follow the same words. Pure.
 */

export interface RenterBadge {
  text: string;
  tone: BadgeTone;
}

/** The list's filters, in the address as plain words (/renters?status=to-review). */
export const RENTER_LIST_FILTERS = [
  "renting",
  "booked",
  "to-review",
  "businesses",
  "drivers",
  "do-not-rent",
  "archived",
] as const;
export type RenterListFilter = (typeof RENTER_LIST_FILTERS)[number];

export const RENTER_LIST_FILTER_LABELS: Readonly<Record<RenterListFilter, string>> = {
  renting: "Renting now",
  booked: "Booked",
  "to-review": "To review",
  businesses: "Businesses",
  drivers: "Drivers",
  "do-not-rent": "Do not rent",
  archived: "Archived",
};

/** Old filter values, from before 7 Nov 2026, and the filter each now opens ("" for All). */
const OLD_FILTER_VALUES: Readonly<Record<string, RenterListFilter | "">> = {
  waiting_review: "to-review",
  do_not_rent: "do-not-rent",
  active: "",
};

function isRenterListFilter(value: string): value is RenterListFilter {
  return RENTER_LIST_FILTERS.some((filter) => filter === value);
}

/**
 * The filter an address asks for: its own word, the new word for an old
 * address (?status=waiting_review opens To review), "" for one that now
 * means them all (?status=active), or undefined for nonsense.
 */
export function renterListFilterOf(value: string | undefined): RenterListFilter | "" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isRenterListFilter(value)) {
    return value;
  }
  return OLD_FILTER_VALUES[value];
}

export interface RenterStanding {
  status: RenterStatus;
  isArchived: boolean;
  isRentingNow: boolean;
  isBooked: boolean;
  isWaitingReview: boolean;
  licenceStatus: ExpiryStatus;
  isOverdue: boolean;
  isBondToRefund: boolean;
}

const BADGES = {
  archived: { text: "Archived", tone: "neutral" },
  doNotRent: { text: "Do not rent", tone: "refused" },
  renting: { text: "Renting", tone: "out" },
  booked: { text: "Booked", tone: "booked" },
  notRenting: { text: "Not renting", tone: "neutral" },
  overdue: { text: "Overdue", tone: "danger" },
  licenceExpired: { text: "Licence expired", tone: "danger" },
  licenceDue: { text: "Licence due", tone: "attention" },
  toReview: { text: "To review", tone: "booked" },
  toRefund: { text: "To refund", tone: "booked" },
} as const satisfies Record<string, RenterBadge>;

/** A licence only matters while the Renter has a car or one booked. */
function licenceBadge(standing: RenterStanding): RenterBadge | null {
  if (!standing.isRentingNow && !standing.isBooked) {
    return null;
  }
  if (standing.licenceStatus === "expired") {
    return BADGES.licenceExpired;
  }
  return standing.licenceStatus === "due_soon" ? BADGES.licenceDue : null;
}

/**
 * The Renter's labels, most telling first: Archived alone; otherwise
 * Renting or Booked, then Do not rent, Overdue, the licence, To review and
 * To refund. "Not renting" shows only when there is nothing else to say.
 */
export function renterBadges(standing: RenterStanding): RenterBadge[] {
  if (standing.isArchived) {
    return [BADGES.archived];
  }
  const renting = standing.isRentingNow ? BADGES.renting : standing.isBooked ? BADGES.booked : null;
  const needsALook = [
    standing.status === "do_not_rent" ? BADGES.doNotRent : null,
    standing.isOverdue ? BADGES.overdue : null,
    licenceBadge(standing),
    standing.isWaitingReview ? BADGES.toReview : null,
    standing.isBondToRefund ? BADGES.toRefund : null,
  ].filter((badge) => badge !== null);
  if (renting) {
    return [renting, ...needsALook];
  }
  return needsALook.length > 0 ? needsALook : [BADGES.notRenting];
}

/**
 * Whether any of a Renter's rentals is overdue, and the longest late: each
 * rental is worked out from its own lines (`overdueOf`, rule 11), as Needs
 * attention does, so a credit on one rental never hides another's arrears.
 */
export function renterOverdueOf(
  lines: readonly (DatedLedgerLine & { rentalId: string })[],
  today: string,
  graceDays: number,
): Overdue | null {
  return longestLateRental(lines, today, graceDays)?.overdue ?? null;
}

/** A rental of the Renter's that is overdue, and by how much. */
export interface LateRental {
  rentalId: string;
  overdue: Overdue;
}

/** The same, with which rental it is: a business's strip names its car. */
export function longestLateRental(
  lines: readonly (DatedLedgerLine & { rentalId: string })[],
  today: string,
  graceDays: number,
): LateRental | null {
  const byRental = new Map<string, DatedLedgerLine[]>();
  for (const line of lines) {
    // Added to in place: copying the list for every line grows with the square of the lines.
    const rentalLines = byRental.get(line.rentalId);
    if (rentalLines) {
      rentalLines.push(line);
    } else {
      byRental.set(line.rentalId, [line]);
    }
  }
  return [...byRental]
    .map(([rentalId, rentalLines]) => ({
      rentalId,
      overdue: overdueOf(rentalLines, today, graceDays),
    }))
    .filter((late): late is LateRental => late.overdue !== null)
    .reduce<LateRental | null>(
      (longest, late) =>
        !longest || late.overdue.daysLate > longest.overdue.daysLate ? late : longest,
      null,
    );
}
