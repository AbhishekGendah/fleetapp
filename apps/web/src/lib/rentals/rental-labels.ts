import {
  DAYS_PER_WEEK,
  BOND_MOVEMENT_KIND_LABELS,
  formatCents,
  formatDateTimeInTimeZone,
  RENTAL_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  RENTAL_TYPE_LABELS,
  WEEKDAY_LABELS,
  WEEKDAYS,
  WITHHELD_VALUE,
  type BookingProblem,
  type Weekday,
} from "@fleetapp/core";

/** What each rental field is called on the rental's page and in its Log. */
const RENTAL_FIELD_LABELS: Readonly<Record<string, string>> = {
  renterId: "Renter",
  vehicleId: "Car",
  type: "Kind",
  status: "Status",
  plannedStart: "Starts",
  plannedEnd: "Ends",
  weeklyRateCents: "Weekly rate",
  bondCents: "Bond",
  chargeWeekday: "Rent charged each",
  notes: "Notes",
  cancellationReason: "Why it was cancelled",
  settingsVersion: "Settings version",
  warnings: "Booked with these warnings",
  kind: "Bond entry",
  amountCents: "Amount",
  method: "How",
  carRego: "Car",
  startedAt: "From",
  endedAt: "Until",
  releasedAt: "Let go at",
};

/** A warning a booking went ahead with, in a few words, for the Log. */
const BOOKING_PROBLEM_LABELS: Readonly<Record<BookingProblem["code"], string>> = {
  do_not_rent: "Renter marked Do not rent",
  car_not_rentable: "car has left the fleet",
  car_not_ready: "car not ready yet",
  details_missing: "Renter's details incomplete",
  licence_expired_by_start: "licence expires before the start",
  under_minimum_age: "Renter under the minimum age",
  provisional_licence: "provisional licence",
  bond_short: "bond not yet received in full",
  direct_debit_missing: "direct debit not set up",
  licence_expires_during: "licence expires during the rental",
};

const MOMENT_FIELDS = new Set(["plannedStart", "plannedEnd", "startedAt", "endedAt", "releasedAt"]);
const CENTS_FIELDS = new Set(["weeklyRateCents", "bondCents", "amountCents"]);
/** Other records, shown on the rental's page; the Log only says they were set. */
const RECORD_FIELDS = new Set(["renterId", "vehicleId"]);

export function rentalFieldLabel(field: string): string {
  return RENTAL_FIELD_LABELS[field] ?? field;
}

/** The fields stored as a code and shown by its label. */
const CODED_FIELD_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  status: RENTAL_STATUS_LABELS,
  type: RENTAL_TYPE_LABELS,
  kind: BOND_MOVEMENT_KIND_LABELS,
  method: PAYMENT_METHOD_LABELS,
};

function describeLabelled(field: string, text: string): string | null {
  const labels = CODED_FIELD_LABELS[field];
  if (labels && Object.hasOwn(labels, text)) {
    return labels[text] ?? null;
  }
  const weekday = WEEKDAYS.find((day) => String(day) === text);
  return field === "chargeWeekday" && weekday ? WEEKDAY_LABELS[weekday] : null;
}

function describeWarnings(value: unknown): string {
  const codes = Array.isArray(value) ? value : [];
  if (codes.length === 0) {
    return "none";
  }
  return codes
    .map((code) => BOOKING_PROBLEM_LABELS[code as BookingProblem["code"]] ?? String(code))
    .join(", ");
}

/** A stored rental value in words, on the Operator's clock. */
export function describeRentalValue(field: string, value: unknown, timeZone: string): string {
  if (field === "warnings") {
    return describeWarnings(value);
  }
  if (value === null || value === undefined || value === "") {
    return field === "plannedEnd" ? "none (ongoing)" : "blank";
  }
  if (value === WITHHELD_VALUE) {
    return "not shown";
  }
  const text = String(value);
  if (RECORD_FIELDS.has(field)) {
    return "set";
  }
  if (MOMENT_FIELDS.has(field)) {
    return formatDateTimeInTimeZone(new Date(text), timeZone);
  }
  if (CENTS_FIELDS.has(field)) {
    return formatCents(Number(text));
  }
  return describeLabelled(field, text) ?? text;
}

/** A rate's start date, as the rental page lists them. */

/**
 * A rental's rate in words: "$70.00 a day" for a short hire, "$350.00 a
 * week" for a long-term rental (seven daily rates when it has no weekly
 * price) or one from before rent in blocks.
 */
export function rentalRateText(rate: {
  weeklyRateCents: number | null;
  dailyRateCents: number | null;
  isLongTerm: boolean | null;
}): string {
  if (rate.isLongTerm === false && rate.dailyRateCents !== null) {
    return `${formatCents(rate.dailyRateCents)} a day`;
  }
  const weekly =
    rate.weeklyRateCents ??
    (rate.dailyRateCents === null ? null : rate.dailyRateCents * DAYS_PER_WEEK);
  return weekly === null ? "No rate" : `${formatCents(weekly)} a week`;
}

/**
 * When rent is charged, in words, for the rental page and contract. Rentals
 * from before rent in blocks were charged on a weekday.
 */
export function rentTimingText(rental: {
  isLongTerm: boolean | null;
  chargeWeekday: number;
}): string {
  if (rental.isLongTerm === null) {
    return `Weekly, each ${WEEKDAY_LABELS[rental.chargeWeekday as Weekday]}`;
  }
  return rental.isLongTerm
    ? "A week at a time in advance, in 24-hour blocks from the handover"
    : "The booked days at the handover, then each extra 24 hours as it starts";
}
