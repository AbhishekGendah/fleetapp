import { addDays, daysBetween, weekdayOfDate } from "./calendar-dates";
import { gstIncludedIn } from "./money";
import type { PartWeekCharging, Weekday } from "./rentals";

/**
 * The ledger (docs/design/06): one per Renter, every line tied to a
 * rental, only ever added to (rule 11). Amounts are positive cents; the
 * kind says which way a line moves the balance. A reversal undoes one
 * earlier line exactly.
 */
export const LEDGER_LINE_KINDS = ["charge", "payment", "credit", "refund", "reversal"] as const;
export type LedgerLineKind = (typeof LEDGER_LINE_KINDS)[number];

export const LEDGER_LINE_KIND_LABELS: Readonly<Record<LedgerLineKind, string>> = {
  charge: "Charge",
  payment: "Payment",
  credit: "Credit",
  refund: "Refund",
  reversal: "Reversal",
};

/** Raises what the Renter owes (+1) or lowers it (-1). A reversal takes the opposite of its line. */
const BALANCE_DIRECTION: Readonly<Record<Exclude<LedgerLineKind, "reversal">, 1 | -1>> = {
  charge: 1,
  refund: 1,
  payment: -1,
  credit: -1,
};

/** How a charge type is treated for GST: set per type by the Operator (rule 9). */
export const GST_TREATMENTS = ["taxable", "gst_free", "no_gst"] as const;
export type GstTreatment = (typeof GST_TREATMENTS)[number];

export const GST_TREATMENT_LABELS: Readonly<Record<GstTreatment, string>> = {
  taxable: "Includes GST (one-eleventh of the amount)",
  gst_free: "GST-free",
  no_gst: "Not subject to GST (e.g. passed on at cost)",
};

/** The charge types every Operator has; Operators add their own beside them. */
export const BUILT_IN_CHARGE_TYPES = [
  "weekly_rent",
  "part_week_rent",
  "late_fee",
  "damage",
  "excess",
  "cleaning",
  "toll",
] as const;
export type BuiltInChargeType = (typeof BUILT_IN_CHARGE_TYPES)[number];

export const BUILT_IN_CHARGE_TYPE_LABELS: Readonly<Record<BuiltInChargeType, string>> = {
  weekly_rent: "Weekly rent",
  part_week_rent: "Part-week rent",
  late_fee: "Late fee",
  damage: "Damage",
  excess: "Insurance excess",
  cleaning: "Cleaning",
  toll: "Toll",
};

/**
 * Each built-in type starts as taxable; the Operator changes any of them in
 * Settings, and the change applies to new lines only. To confirm with the
 * accountant (docs/legal-notes.md): damage, excess and tolls passed on.
 */
export const DEFAULT_GST_TREATMENT: GstTreatment = "taxable";

/** The two built-in types the daily rent job charges. */
export const RENT_CHARGE_TYPES: ReadonlySet<BuiltInChargeType> = new Set([
  "weekly_rent",
  "part_week_rent",
]);

/**
 * The GST in a line: one-eleventh of a taxable amount, to the nearest
 * cent, and only when the Operator is registered on the line's date.
 * Stored on the line once and never worked out again (rule 9).
 */
export function gstForLine(
  amountCents: number,
  treatment: GstTreatment,
  isRegisteredOnLineDate: boolean,
): number {
  return treatment === "taxable" && isRegisteredOnLineDate ? gstIncludedIn(amountCents) : 0;
}

/** Whether the Operator was GST-registered on a date (no date: never registered). */
export function isGstRegisteredOn(registeredFrom: string | null, isoDate: string): boolean {
  return registeredFrom !== null && registeredFrom <= isoDate;
}

export interface LedgerLineAmount {
  id: string;
  kind: LedgerLineKind;
  amountCents: number;
  /** The line a reversal undoes. */
  reversesId: string | null;
}

/** How one line moves the balance, in signed cents. */
function balanceEffect(
  line: LedgerLineAmount,
  linesById: ReadonlyMap<string, LedgerLineAmount>,
): number {
  if (line.kind !== "reversal") {
    return BALANCE_DIRECTION[line.kind] * line.amountCents;
  }
  const reversed = line.reversesId ? linesById.get(line.reversesId) : undefined;
  return reversed ? -balanceEffect(reversed, linesById) : 0;
}

/** What the Renter owes: the sum of every line (rule 11). Negative when in credit. */
export function ledgerBalanceCents(lines: readonly LedgerLineAmount[]): number {
  const linesById = new Map(lines.map((line) => [line.id, line]));
  return lines.reduce((total, line) => total + balanceEffect(line, linesById), 0);
}

/** The lines that can still be reversed: not a reversal, and not reversed already. */
export function reversibleLineIds(lines: readonly LedgerLineAmount[]): Set<string> {
  const reversed = new Set(lines.flatMap((line) => (line.reversesId ? [line.reversesId] : [])));
  return new Set(
    lines
      .filter((line) => line.kind !== "reversal" && !reversed.has(line.id))
      .map((line) => line.id),
  );
}

export interface DatedLedgerLine extends LedgerLineAmount {
  /** The day it counts from, "2026-11-03". */
  effectiveOn: string;
}

export interface OwingCharge {
  id: string;
  effectiveOn: string;
  owingCents: number;
}

/**
 * Which charges are still owing, oldest first: everything paid or credited
 * pays off the oldest charges first, so each charge is paid or owing, and
 * owing has an age.
 */
export function owingCharges(lines: readonly DatedLedgerLine[]): OwingCharge[] {
  const reversed = new Set(lines.flatMap((line) => (line.reversesId ? [line.reversesId] : [])));
  const linesById = new Map(lines.map((line) => [line.id, line]));
  // A reversed line and its reversal cancel out: neither counts.
  const standing = lines.filter((line) => line.kind !== "reversal" && !reversed.has(line.id));
  const raising = standing
    .filter((line) => balanceEffect(line, linesById) > 0)
    .sort((first, second) => first.effectiveOn.localeCompare(second.effectiveOn));
  let paidOff = -standing.reduce(
    (total, line) => total + Math.min(0, balanceEffect(line, linesById)),
    0,
  );
  return raising.flatMap((line) => {
    const owed = balanceEffect(line, linesById);
    const covered = Math.min(owed, paidOff);
    paidOff -= covered;
    return owed > covered
      ? [{ id: line.id, effectiveOn: line.effectiveOn, owingCents: owed - covered }]
      : [];
  });
}

export const DAYS_PER_WEEK = 7;

/**
 * A weekly rate as seven daily shares that add back to it exactly: the
 * odd cents go to the first days. $350.00 is seven $50.00 days; $350.05
 * gives the first five days a cent more.
 */
export function dailyShares(weeklyRateCents: number): number[] {
  const base = Math.floor(weeklyRateCents / DAYS_PER_WEEK);
  const left = weeklyRateCents - base * DAYS_PER_WEEK;
  return Array.from({ length: DAYS_PER_WEEK }, (_, day) => base + (day < left ? 1 : 0));
}

/** A weekly rate and the day it applies from (the rental's rate history). */
export interface RateFromDate {
  appliesFrom: string;
  weeklyRateCents: number;
}

/**
 * The rate in force on a day. A day before the first rate (a car handed
 * over ahead of the planned start) is at the first rate.
 */
function rateOn(rates: readonly RateFromDate[], isoDate: string): number {
  const byDate = [...rates].sort((first, second) =>
    first.appliesFrom.localeCompare(second.appliesFrom),
  );
  const inForce = byDate.filter((rate) => rate.appliesFrom <= isoDate).at(-1) ?? byDate[0];
  if (!inForce) {
    throw new RangeError("A rental always has a weekly rate.");
  }
  return inForce.weeklyRateCents;
}

/**
 * The rent for the first `dayCount` days of a period, each day at the rate
 * in force on it (decision 4), so a full week at one rate is exactly that
 * rate and a change part-way through is charged from its own day.
 */
export function rentForDays(
  rates: readonly RateFromDate[],
  periodStart: string,
  dayCount: number,
): number {
  let total = 0;
  for (let day = 0; day < dayCount; day += 1) {
    const share = dailyShares(rateOn(rates, addDays(periodStart, day)))[day % DAYS_PER_WEEK];
    total += share ?? 0;
  }
  return total;
}

/** One period rent is charged for, in advance, on its first day. */
export interface RentPeriod {
  /** First day, "2026-11-03". */
  start: string;
  /** The day after the last. */
  end: string;
  /** Shorter than a week: the first period, when the handover is not on the charge day. */
  isPartWeek: boolean;
}

export interface RentScheduleInput {
  /** The handover's date on the Operator's clock: rent starts with the car (rule 15). */
  handoverDate: string;
  chargeWeekday: Weekday;
  /** The Operator's today: periods that have started by then are due. */
  today: string;
  /** The return's date, if the car is back: no period starts on or after it. */
  returnDate: string | null;
}

/** The first charge day on or after a date. */
function nextChargeDay(isoDate: string, chargeWeekday: Weekday): string {
  const ahead = (chargeWeekday - weekdayOfDate(isoDate) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return addDays(isoDate, ahead);
}

/**
 * Every rent period due by today: a part week from the handover to the
 * first charge day (if they differ), then a week from each charge day,
 * while the car is out (overdue too: rent runs until it is back).
 */
export function dueRentPeriods(input: RentScheduleInput): RentPeriod[] {
  const firstChargeDay = nextChargeDay(input.handoverDate, input.chargeWeekday);
  const periods: RentPeriod[] = [];
  const isStillDue = (start: string) =>
    start <= input.today && (input.returnDate === null || start < input.returnDate);
  if (firstChargeDay !== input.handoverDate && isStillDue(input.handoverDate)) {
    periods.push({ start: input.handoverDate, end: firstChargeDay, isPartWeek: true });
  }
  for (let start = firstChargeDay; isStillDue(start); start = addDays(start, DAYS_PER_WEEK)) {
    periods.push({ start, end: addDays(start, DAYS_PER_WEEK), isPartWeek: false });
  }
  return periods;
}

/** A period's rent: by the day for a part week, or the full week, as the rental's setting says. */
export function rentForPeriod(
  rates: readonly RateFromDate[],
  period: RentPeriod,
  partWeekCharging: PartWeekCharging,
): number {
  const dayCount =
    period.isPartWeek && partWeekCharging === "full_week"
      ? DAYS_PER_WEEK
      : daysBetween(period.start, period.end);
  return rentForDays(rates, period.start, dayCount);
}

/**
 * The credit for the days of a charged period after the car came back
 * (the return day counts as used). None when part weeks are charged as a
 * full week, or the return is not inside the period.
 */
export function unusedDaysCredit(
  rates: readonly RateFromDate[],
  period: RentPeriod,
  returnDate: string,
  partWeekCharging: PartWeekCharging,
): number {
  if (partWeekCharging === "full_week" || returnDate < period.start || returnDate >= period.end) {
    return 0;
  }
  const usedDays = daysBetween(period.start, returnDate) + 1;
  return (
    rentForPeriod(rates, period, partWeekCharging) - rentForDays(rates, period.start, usedDays)
  );
}
