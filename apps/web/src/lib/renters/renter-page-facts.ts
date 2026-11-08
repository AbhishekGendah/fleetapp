import {
  formatCalendarDate,
  formatMonthYearInTimeZone,
  LICENCE_TYPE_LABELS,
  type ExpiryStatus,
  type LicenceType,
  type Overdue,
} from "@fleetapp/core";

import { owingFact, type RentalFact } from "../rentals/rental-page-facts";
import { licenceIssuedInText } from "./licence-text";
import type { RenterRenting } from "./renter-list-rows";

/**
 * The key facts on one Renter's navy strip (docs/plans/look-and-feel.md,
 * "Cars and Renters pages"): what they owe (from the ledger, rule 11), their
 * licence (its type, where it was issued and its expiry: never its number,
 * Abhi 7 Nov 2026), and since when they have rented. Pure.
 */

/** Owing as on a rental's strip; when a rental is overdue, how late instead of since when. */
export function renterOwingFact(
  ledger: { balanceCents: number; oldestOwingOn: string | null },
  overdue: Overdue | null,
  today: string,
): RentalFact {
  const fact = owingFact(ledger, today);
  if (!overdue || ledger.balanceCents <= 0) {
    return fact;
  }
  return {
    ...fact,
    note: overdue.daysLate === 1 ? "1 day late" : `${overdue.daysLate} days late`,
  };
}

/** "Full · VIC", "Expires 14 Mar 2029". The licence number is never part of it. */
export function licenceFact(licence: {
  licenceType: LicenceType | null;
  licenceIssuedIn: string | null;
  licenceCountry: string | null;
  licenceExpiresOn: string | null;
  status: ExpiryStatus;
}): RentalFact {
  if (!licence.licenceType || !licence.licenceExpiresOn) {
    return { label: "Licence", value: "Not on file" };
  }
  const issuedIn = licenceIssuedInText(licence.licenceIssuedIn, licence.licenceCountry);
  const expiry = formatCalendarDate(licence.licenceExpiresOn);
  return {
    label: "Licence",
    value: [LICENCE_TYPE_LABELS[licence.licenceType], issuedIn].filter(Boolean).join(" · "),
    note: licence.status === "expired" ? `Expired ${expiry}` : `Expires ${expiry}`,
  };
}

/** "Jul 2026", "2 rentals". Drafts and cancelled bookings are not counted. */
export function withYouSinceFact(addedAt: Date, rentalCount: number, timeZone: string): RentalFact {
  return {
    label: "With you since",
    value: formatMonthYearInTimeZone(addedAt, timeZone),
    note:
      rentalCount === 0
        ? "No rentals yet"
        : rentalCount === 1
          ? "1 rental"
          : `${rentalCount} rentals`,
  };
}

/** Words read on mid-sentence: "Hyundai i30 · back Tue 10 Nov", "1 booked, starts Mon 9 Nov". */
export function midSentence(words: string): string {
  return words.charAt(0).toLowerCase() + words.slice(1);
}

/**
 * The car the Renter has (or has booked), and when it is back or starts; the
 * strip makes its rego the value, a link to the car. With no car: when they
 * last had one back.
 */
export function rentingFact(renting: RenterRenting): { label: string; note: string } {
  const { rental } = renting;
  if (!rental) {
    return { label: "Renting now", note: renting.words };
  }
  return {
    label: rental.status === "active" ? "Renting now" : "Booked",
    note: `${rental.make} ${rental.model} · ${midSentence(renting.shortWords)}`,
  };
}
