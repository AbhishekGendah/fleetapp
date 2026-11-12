import { addDays, todayInTimeZone } from "./calendar-dates";
import { formatShortCalendarDate } from "./format-date-time";
import type { DebitCollectionPlan } from "./weekly-debits";

/**
 * One-off charges are told before they are debited
 * (docs/plans/one-off-charge-notice.md, approved by Abhi on 12 Nov 2026):
 * every one-off charge gets its own invoice, emailed to the Renter at once,
 * and is debited no earlier than its notice date, the day that email was
 * sent (on the business's calendar) plus the notice period.
 */

/** The notice period a business starts with (Abhi, 12 Nov 2026: 3 days, not 14). */
export const DEFAULT_ONE_OFF_NOTICE_DAYS = 3;
/** Never shorter: the lawyer to confirm (docs/legal-notes.md). */
export const MINIMUM_ONE_OFF_NOTICE_DAYS = 3;
/** Longer is allowed up to Stripe's own notice for a changed debit (30 days); two digits in the box. */
export const MAXIMUM_ONE_OFF_NOTICE_DAYS = 30;

/** The plans that debit a one-off charge at all: each waits for its notice date. */
export function isDebitingPlan(plan: DebitCollectionPlan): boolean {
  return plan !== "not_debited";
}

/**
 * The first day a one-off charge may be debited, as "YYYY-MM-DD" on the
 * business's calendar: the day its invoice was emailed, where the business
 * is, plus the notice period. Whole days, so a daylight-saving change or a
 * late-evening email never moves it.
 */
export function oneOffNoticeDate(emailedAt: Date, timeZone: string, noticeDays: number): string {
  return addDays(todayInTimeZone(emailedAt, timeZone), noticeDays);
}

/**
 * Whether a one-off charge may be debited on `today` (the business's day):
 * only once its invoice was emailed (a notice date) and that date has come.
 * No email, no debit.
 */
export function isNoticeDateReached(noticeDate: string | null, today: string): boolean {
  return noticeDate !== null && noticeDate <= today;
}

/** How each plan reads with its first possible debit day, e.g. "Debit on Sun 15 Nov". */
export function debitPlanLabelOn(
  plan: DebitCollectionPlan,
  noticeDate: string,
  today: string,
): string {
  const day = formatShortCalendarDate(noticeDate, today);
  switch (plan) {
    case "not_debited":
      return "Invoice only, don't debit";
    case "own_debit":
      return `Debit on ${day}`;
    case "next_debit":
      return `With the first weekly debit on or after ${day}`;
    case "split":
      return `Split over weekly debits, from ${day}`;
  }
}

/**
 * The Renter's email's words for how a charge will be debited, e.g.
 * "It will be debited from your account ending 3456 on Sun 15 Nov 2026.";
 * null when it won't be debited.
 */
export function chargeDebitNoticeText(input: {
  plan: DebitCollectionPlan;
  weeks: number | null;
  noticeDate: string;
  accountEnding: string;
}): string | null {
  // The Renter may read it next year, so the year is always given.
  const day = formatShortCalendarDate(input.noticeDate, "");
  const account = `your account ending ${input.accountEnding}`;
  switch (input.plan) {
    case "not_debited":
      return null;
    case "own_debit":
      return `It will be debited from ${account} on ${day}.`;
    case "next_debit":
      return `It will be debited from ${account} with your first weekly debit on or after ${day}.`;
    case "split":
      return `It will be debited from ${account} in ${input.weeks ?? 0} weekly parts, the first on or after ${day}.`;
  }
}

/** What the business sees on a one-off charge about its invoice's email and its debit. */
export function chargeNoticeStatusText(input: {
  /** The day its invoice was first emailed, on the business's calendar; null if never. */
  emailedOn: string | null;
  /** Its plan, if it has one (a Renter paying by direct debit). */
  plan: DebitCollectionPlan | null;
  noticeDate: string | null;
  today: string;
}): string {
  const isDebited = input.plan !== null && isDebitingPlan(input.plan);
  if (input.emailedOn === null) {
    return isDebited ? "Invoice not sent: email it before it can be debited" : "Invoice not sent";
  }
  const emailed = `Invoice emailed ${formatShortCalendarDate(input.emailedOn, input.today)}`;
  if (!isDebited) {
    return emailed;
  }
  return input.noticeDate
    ? `${emailed} · debit on ${formatShortCalendarDate(input.noticeDate, input.today)}`
    : `${emailed} without a debit date: email it again before it can be debited`;
}
