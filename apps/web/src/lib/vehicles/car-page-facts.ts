import {
  daysBetween,
  formatCents,
  formatKilometres,
  formatShortCalendarDate,
  formatShortDayInTimeZone,
  todayInTimeZone,
  type ExpiryStatus,
} from "@fleetapp/core";
import type { OdometerSource } from "@fleetapp/db/schema";

import type { RentalClock } from "../rentals/rental-records";

/**
 * The key facts on one car's navy strip (docs/plans/look-and-feel.md, "Cars
 * and Renters pages"): its odometer and where that reading came from, its
 * rego and insurance and when they are due, and its prices. Pure: the page
 * loads the records and these only put them into words.
 */

export interface CarFact {
  label: string;
  value: string;
  note?: string;
}

/** Where a reading came from, before its day: "At handover Fri 6 Nov". */
const READING_SOURCE_WORDS: Readonly<Record<OdometerSource, string>> = {
  purchase: "When added",
  handover: "At handover",
  return: "At return",
  service: "At a service",
  renter: "From the Renter",
  manual: "Typed in",
};

const MISSING = "Missing";

export function odometerFact(
  reading: { kilometres: number; recordedAt: Date; source: OdometerSource } | null,
  clock: RentalClock,
): CarFact {
  if (!reading) {
    return { label: "Odometer", value: "Not recorded" };
  }
  const today = todayInTimeZone(clock.now, clock.timeZone);
  return {
    label: "Odometer",
    value: formatKilometres(reading.kilometres),
    note: `${READING_SOURCE_WORDS[reading.source]} ${formatShortDayInTimeZone(reading.recordedAt, clock.timeZone, today)}`,
  };
}

/** "Due in 6 days", "Due today", "Expired": how a date stands, for a note. */
function dueWords(date: string, status: ExpiryStatus, today: string): string | null {
  if (status === "expired") {
    return "Expired";
  }
  if (status !== "due_soon") {
    return null;
  }
  const days = daysBetween(today, date);
  if (days === 0) {
    return "Due today";
  }
  return days === 1 ? "Due in 1 day" : `Due in ${days} days`;
}

export function regoFact(
  rego: {
    isOnDirectDebit: boolean;
    expiresOn: string | null;
    status: ExpiryStatus;
    state: string;
  },
  today: string,
): CarFact {
  if (rego.isOnDirectDebit) {
    return { label: "Rego", value: "Direct debit", note: rego.state };
  }
  if (!rego.expiresOn) {
    return { label: "Rego", value: MISSING, note: rego.state };
  }
  const due = dueWords(rego.expiresOn, rego.status, today);
  return {
    label: "Rego",
    value: formatShortCalendarDate(rego.expiresOn, today),
    note: due ? `${due} · ${rego.state}` : rego.state,
  };
}

export function insuranceFact(
  insurance: { endsOn: string | null; status: ExpiryStatus; insurer: string | null },
  today: string,
): CarFact {
  if (!insurance.endsOn) {
    return { label: "Insurance", value: MISSING };
  }
  const due = dueWords(insurance.endsOn, insurance.status, today);
  const note = [due, insurance.insurer].filter(Boolean).join(" · ");
  return {
    label: "Insurance",
    value: formatShortCalendarDate(insurance.endsOn, today),
    ...(note ? { note } : {}),
  };
}

/** "$350.00/wk" with "$60.00 a day" under it; the daily rate alone when there is no weekly. */
export function priceFact(prices: {
  dailyRateCents: number | null;
  longTermWeeklyCents: number | null;
}): CarFact {
  if (prices.dailyRateCents === null) {
    return { label: "Price", value: "Not set", note: "Add a daily rate" };
  }
  const daily = `${formatCents(prices.dailyRateCents)} a day`;
  return prices.longTermWeeklyCents === null
    ? { label: "Price", value: `${formatCents(prices.dailyRateCents)}/day` }
    : { label: "Price", value: `${formatCents(prices.longTermWeeklyCents)}/wk`, note: daily };
}
