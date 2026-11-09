import {
  lineTotalsOf,
  statementFigures,
  type DatedLedgerLine,
  type LedgerLineAmount,
} from "./ledger";

/**
 * A business Renter's statement across its cars (docs/plans/business-renters.md,
 * "Money correctness"): each rental's own statement figures, by the one
 * ledger rule (rule 11), set side by side. Nothing new is worked out: each
 * line counts under Charged or Paid as `ledgerTotals` counts it (a credit is
 * less charged, a refund less paid, a reversal under what it undoes), so
 * every car's brought forward, plus charged, less paid, is its closing
 * balance, and the business's totals are the sum of its cars'. A reversal is
 * always on the rental of the line it undoes, so each rental nets on its own.
 */

export interface StatementEntry<Line extends DatedLedgerLine> {
  line: Line;
  /** What the line adds to charged (a credit: less); nought for a payment or refund. */
  chargedCents: number;
  /** What the line adds to paid (a refund: less); nought for a charge or credit. */
  paidCents: number;
}

/** The money totals of a statement part: before, during and after its days. */
export interface StatementTotals {
  /** Owed before the first day; negative when in credit. */
  openingCents: number;
  chargedCents: number;
  paidCents: number;
  /** Owed at the end of the last day: opening plus charged less paid. */
  closingCents: number;
}

export interface CarStatement<Line extends DatedLedgerLine> extends StatementTotals {
  rentalId: string;
  entries: StatementEntry<Line>[];
}

export interface BusinessStatementFigures<Line extends DatedLedgerLine> extends StatementTotals {
  /** Each rental with a line in the days or a balance brought into them, oldest first. */
  cars: CarStatement<Line>[];
}

function linesByRental<Line extends DatedLedgerLine & { rentalId: string }>(
  lines: readonly Line[],
): Map<string, Line[]> {
  const grouped = new Map<string, Line[]>();
  for (const line of lines) {
    grouped.set(line.rentalId, [...(grouped.get(line.rentalId) ?? []), line]);
  }
  return grouped;
}

/** One rental's part: its statement figures, each line counted as charged or paid. */
function carStatementOf<Line extends DatedLedgerLine>(
  rentalId: string,
  lines: readonly Line[],
  fromDate: string,
  toDate: string,
): CarStatement<Line> {
  const figures = statementFigures(lines, fromDate, toDate);
  const linesById = new Map<string, LedgerLineAmount>(lines.map((line) => [line.id, line]));
  const entries = figures.lines.map(({ line }) => ({ line, ...lineTotalsOf(line, linesById) }));
  return {
    rentalId,
    entries,
    openingCents: figures.openingCents,
    chargedCents: entries.reduce((total, entry) => total + entry.chargedCents, 0),
    paidCents: entries.reduce((total, entry) => total + entry.paidCents, 0),
    closingCents: figures.closingCents,
  };
}

/** The rental's first day on the ledger, so cars are listed in the order they were rented. */
function firstDayOf(lines: readonly DatedLedgerLine[]): string {
  return lines.reduce(
    (first, line) => (line.effectiveOn < first ? line.effectiveOn : first),
    lines[0]?.effectiveOn ?? "",
  );
}

/**
 * The statement for `fromDate` to `toDate` (both included) across every
 * rental the lines are on. A rental with nothing in the days and nothing
 * owing or in credit before them is left out. Pure.
 */
export function businessStatementFigures<Line extends DatedLedgerLine & { rentalId: string }>(
  lines: readonly Line[],
  fromDate: string,
  toDate: string,
): BusinessStatementFigures<Line> {
  const cars = [...linesByRental(lines)]
    .sort(([, first], [, second]) => firstDayOf(first).localeCompare(firstDayOf(second)))
    .map(([rentalId, rentalLines]) => carStatementOf(rentalId, rentalLines, fromDate, toDate))
    .filter((car) => car.entries.length > 0 || car.openingCents !== 0);
  const sum = (pick: (car: StatementTotals) => number) =>
    cars.reduce((total, car) => total + pick(car), 0);
  return {
    cars,
    openingCents: sum((car) => car.openingCents),
    chargedCents: sum((car) => car.chargedCents),
    paidCents: sum((car) => car.paidCents),
    closingCents: sum((car) => car.closingCents),
  };
}
