import { gstIncludedIn } from "./money";

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
  "daily_rent",
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
  daily_rent: "Daily rent",
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

/** The built-in types the rent run charges. */
export const RENT_CHARGE_TYPES: ReadonlySet<BuiltInChargeType> = new Set([
  "weekly_rent",
  "daily_rent",
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

/** Which total a kind of line counts in: charged (charges less credits) or paid (payments less refunds). */
const TOTAL_OF_KIND: Readonly<Record<Exclude<LedgerLineKind, "reversal">, "charged" | "paid">> = {
  charge: "charged",
  credit: "charged",
  payment: "paid",
  refund: "paid",
};

export interface LedgerTotals {
  /** Charges less credits (rent corrections included). */
  chargedCents: number;
  /** Payments less refunds. */
  paidCents: number;
  /** Charged less paid: what the Renter owes, negative when in credit. */
  balanceCents: number;
}

/**
 * Charged, paid and owing, added up from the lines (rule 11). A reversal
 * nets against the line it undoes, so a reversed charge is neither charged
 * nor owed. The balance is always the same as `ledgerBalanceCents`.
 */
export function ledgerTotals(lines: readonly LedgerLineAmount[]): LedgerTotals {
  const linesById = new Map(lines.map((line) => [line.id, line]));
  const totals = { charged: 0, paid: 0 };
  for (const line of lines) {
    const counted = line.kind === "reversal" ? linesById.get(line.reversesId ?? "") : line;
    if (!counted || counted.kind === "reversal") {
      continue;
    }
    const effect = balanceEffect(line, linesById);
    const total = TOTAL_OF_KIND[counted.kind];
    totals[total] += total === "charged" ? effect : -effect;
  }
  return {
    chargedCents: totals.charged,
    paidCents: totals.paid,
    balanceCents: totals.charged - totals.paid,
  };
}

export interface StatementFigures<Line extends DatedLedgerLine> {
  /** The balance at the start of the first day. */
  openingCents: number;
  /** The lines in the range, oldest first, each with the balance after it. */
  lines: { line: Line; balanceAfterCents: number }[];
  closingCents: number;
}

/**
 * A statement for the days from `fromDate` to `toDate` (both included): the
 * balance before them, each line in them with the balance after it, and the
 * balance at the end. Every figure is added up from the lines (rule 11).
 */
export function statementFigures<Line extends DatedLedgerLine>(
  lines: readonly Line[],
  fromDate: string,
  toDate: string,
): StatementFigures<Line> {
  const linesById = new Map<string, LedgerLineAmount>(lines.map((line) => [line.id, line]));
  const oldestFirst = [...lines].sort((first, second) =>
    first.effectiveOn.localeCompare(second.effectiveOn),
  );
  const openingCents = oldestFirst
    .filter((line) => line.effectiveOn < fromDate)
    .reduce((total, line) => total + balanceEffect(line, linesById), 0);
  let running = openingCents;
  const inRange = oldestFirst
    .filter((line) => line.effectiveOn >= fromDate && line.effectiveOn <= toDate)
    .map((line) => {
      running += balanceEffect(line, linesById);
      return { line, balanceAfterCents: running };
    });
  return { openingCents, lines: inRange, closingCents: running };
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
