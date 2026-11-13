import { addDays, todayInTimeZone } from "./calendar-dates";
import { formatShortCalendarDate } from "./format-date-time";
import type { DebitCollectionPlan } from "./weekly-debits";

/**
 * One-off charges are told before they are debited
 * (docs/plans/one-off-charge-notice.md, approved by Abhi on 12 Nov 2026):
 * every one-off charge gets its own invoice, emailed to the Renter at once,
 * and is debited only inside the window that email stated: from its notice
 * date (the day it was sent, on the business's calendar, plus the notice
 * period) to NOTICE_LAPSE_DAYS after. A notice is for the exact plan it
 * stated: any change of plan voids it (review fixes, 13 Nov 2026).
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
 * A notice lapses if its part isn't debited within this many days of the day
 * it was due (a pause, Stripe not ready): it is then emailed again with a new
 * date, and nothing is taken until that one has run. The Renter is only ever
 * debited inside the window their email stated.
 */
export const NOTICE_LAPSE_DAYS = 7;
const DAYS_PER_WEEK = 7;

/**
 * How far ahead of the database's clock a debit's or a notice's time may be
 * (migration 0064 checks it, as `interval '5 minutes'`): the app's server
 * clock may run a little ahead of the database's.
 */
export const DEBIT_CLOCK_MARGIN_MINUTES = 5;
/**
 * How long after an email was sent its notice may still be recorded (0064:
 * `interval '1 hour'`): a slow send or a nightly run near its time limit.
 * Its notice days count from the day it was sent, never the day recorded.
 */
export const NOTICE_SEND_WINDOW_MINUTES = 60;
/**
 * The nightly notice run emails a plan at most this many times since its
 * last change, its last notice or the business's last Email again (a failed
 * send, one with no debit stated, or a lapsed notice), then the charge asks
 * the business to email it instead.
 */
export const AUTOMATIC_NOTICE_LIMIT = 2;

/** A notice as emailed: its first debit day and the parts of the charge already debited then. */
export interface ChargeNoticeTerms {
  noticeDate: string;
  partsBefore: number;
}

/**
 * The days a part (1 for a whole charge; 1 to N of a split) may be debited
 * under a notice: from the week it falls in (a split's parts come a week
 * apart, the first from the notice date) until NOTICE_LAPSE_DAYS after.
 * Null for a part the notice doesn't cover.
 */
export function noticeWindow(
  notice: ChargeNoticeTerms,
  instalment: number,
): { from: string; until: string } | null {
  const weeksIn = instalment - 1 - notice.partsBefore;
  if (weeksIn < 0) {
    return null;
  }
  const from = addDays(notice.noticeDate, weeksIn * DAYS_PER_WEEK);
  return { from, until: addDays(from, NOTICE_LAPSE_DAYS) };
}

/** Whether a part may be debited on `today` (the business's day) under a notice. No notice, no debit. */
export function isWithinNotice(
  notice: ChargeNoticeTerms | null,
  instalment: number,
  today: string,
): boolean {
  const window = notice ? noticeWindow(notice, instalment) : null;
  return window !== null && window.from <= today && today <= window.until;
}

/** Whether a notice has run out for a part: its window passed with the part still not debited. */
export function isNoticeLapsed(
  notice: ChargeNoticeTerms,
  instalment: number,
  today: string,
): boolean {
  const window = noticeWindow(notice, instalment);
  return window === null || today > window.until;
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
 * The Renter's email's words for how a charge will be debited, with the
 * window its next part may be taken in, e.g. "It will be debited from your
 * account ending 3456 on or after Sun 15 Nov 2026, and no later than Sun 22
 * Nov 2026."; null when it won't be debited.
 */
export function chargeDebitNoticeText(input: {
  plan: DebitCollectionPlan;
  /** For a split: the parts still to take. */
  weeks: number | null;
  /** The next part's window (noticeWindow). */
  window: { from: string; until: string };
  /** Whether a split's next part is its first. */
  isFirstPart: boolean;
  accountEnding: string;
}): string | null {
  // The Renter may read it next year, so the year is always given.
  const day = formatShortCalendarDate(input.window.from, "");
  const lastDay = formatShortCalendarDate(input.window.until, "");
  const account = `your account ending ${input.accountEnding}`;
  switch (input.plan) {
    case "not_debited":
      return null;
    case "own_debit":
      return `It will be debited from ${account} on or after ${day}, and no later than ${lastDay}.`;
    case "next_debit":
      return `It will be debited from ${account} with your first weekly debit on or after ${day}, and no later than ${lastDay}.`;
    case "split":
      return `It will be debited from ${account} in ${input.weeks ?? 0} weekly parts, the ${input.isFirstPart ? "first" : "next"} on or after ${day} and no later than ${lastDay}, then one each week.`;
  }
}

/** What the business sees on a one-off charge about its invoice's email and its debit. */
export function chargeNoticeStatusText(input: {
  /** The day its invoice was first emailed, on the business's calendar; null if never. */
  emailedOn: string | null;
  /** Its plan, if it has one (a Renter paying by direct debit). */
  plan: DebitCollectionPlan | null;
  /** Its current notice's first day; none when it has none, or it lapsed or was voided. */
  noticeDate: string | null;
  /** Nothing is left owing for it to take (paid another way), and no notice stands: none is coming. */
  isCovered?: boolean;
  /** The nightly run stopped emailing it (AUTOMATIC_NOTICE_LIMIT): the business must. */
  isGivenUp?: boolean;
  today: string;
}): string {
  const isDebited = input.plan !== null && isDebitingPlan(input.plan);
  const emailed = input.emailedOn
    ? `Invoice emailed ${formatShortCalendarDate(input.emailedOn, input.today)}`
    : "Invoice not sent";
  if (!isDebited) {
    return emailed;
  }
  // A notice given stands (it is what the Renter was told); covered only explains why none is coming.
  if (input.noticeDate) {
    return `${emailed} · debit on ${formatShortCalendarDate(input.noticeDate, input.today)}`;
  }
  if (input.isCovered) {
    return `${emailed} · covered: nothing left owing to debit`;
  }
  if (input.isGivenUp) {
    return `${emailed} · Couldn't email the debit date: Email invoice again`;
  }
  return input.emailedOn
    ? `${emailed} without a current debit date: email it again before it can be debited`
    : "Invoice not sent: email it before it can be debited";
}
