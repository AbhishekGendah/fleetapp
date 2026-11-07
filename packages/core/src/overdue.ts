import { daysBetween } from "./calendar-dates";
import { owingCharges, type DatedLedgerLine } from "./ledger";

/**
 * Overdue (docs/plans/look-slice-2-overdue.md): money a Renter still owes
 * some days after it was due. "Grace days" is one setting for the whole
 * business: Needs attention reads it now, and the late fee (Phase 4 slice 6)
 * will copy it onto each rental, because that one charges money (rule 14).
 */
export const DEFAULT_PAYMENT_GRACE_DAYS = 2;
export const MAXIMUM_PAYMENT_GRACE_DAYS = 30;

export interface Overdue {
  /** Everything owing on the lines whose grace has passed, in cents. */
  overdueCents: number;
  /** Whole days since the oldest owing charge was due. */
  daysLate: number;
  /** The day the oldest owing charge was due, "2026-10-29". */
  oldestDueOn: string;
}

/**
 * Whether these lines are overdue on `today` (the Operator's own calendar
 * day, rule 10), and by how much. Payments and credits pay the oldest
 * charges first (`owingCharges`), so the oldest owing charge decides: it is
 * overdue once more than `graceDays` have passed since its due day. Null when
 * nothing is past its grace. Always worked out from the lines (rule 11).
 *
 * TODO(Phase 4 slice 5): direct debits plug in here. A failed debit makes the
 * rental overdue at once, and money still on its way by debit is not counted
 * as overdue (docs/plans/look-slice-2-overdue.md, "Direct debits").
 */
export function overdueOf(
  lines: readonly DatedLedgerLine[],
  today: string,
  graceDays: number,
): Overdue | null {
  const pastGrace = owingCharges(lines).filter(
    (charge) => daysBetween(charge.effectiveOn, today) > graceDays,
  );
  const oldest = pastGrace[0];
  if (!oldest) {
    return null;
  }
  return {
    overdueCents: pastGrace.reduce((total, charge) => total + charge.owingCents, 0),
    daysLate: daysBetween(oldest.effectiveOn, today),
    oldestDueOn: oldest.effectiveOn,
  };
}
