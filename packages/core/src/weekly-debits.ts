import { STRIPE_MINIMUM_CHARGE_CENTS } from "./direct-debits";
import { DAYS_PER_WEEK, ledgerBalanceCents, type LedgerLineAmount } from "./ledger";
import { AUSTRALIAN_LOCALE } from "./locale";
import { BLOCK_MILLISECONDS } from "./rent-blocks";
import { MILLISECONDS_PER_DAY, MILLISECONDS_PER_MINUTE } from "./time-units";

/**
 * Weekly debits (docs/plans/phase-4-slice-5.md): the business asks Stripe
 * to take each rent week from the Renter's bank under their direct debit,
 * once the week is charged. Only the scheduled amount, never the balance,
 * and never more than is owing on that rental.
 */

/**
 * How a one-off charge is collected. Every one defaults to invoice only
 * (decision 2 as changed by Abhi on 9 Nov): no disputed charge is taken
 * from a bank without the Renter's agreement.
 */
export const DEBIT_COLLECTION_PLANS = ["not_debited", "next_debit", "own_debit", "split"] as const;
export type DebitCollectionPlan = (typeof DEBIT_COLLECTION_PLANS)[number];

/** The default for every one-off charge, copied onto each rental with its settings (rule 14). */
export const DEFAULT_ONE_OFF_COLLECTION: DebitCollectionPlan = "not_debited";

export const DEBIT_COLLECTION_PLAN_LABELS: Readonly<Record<DebitCollectionPlan, string>> = {
  not_debited: "Invoice only, don't debit",
  next_debit: "Take it with the next weekly debit",
  own_debit: "Take it now",
  split: "Split over weekly debits",
};

/** The plans that wait for weekly debits, so offered only while the car is out. */
export const WEEKLY_DEBIT_PLANS: ReadonlySet<DebitCollectionPlan> = new Set([
  "next_debit",
  "split",
]);

/** The plans a rental can take: a returned or cancelled one has no more weekly debits. */
export function debitPlansOffered(isCarOut: boolean): DebitCollectionPlan[] {
  return DEBIT_COLLECTION_PLANS.filter((plan) => isCarOut || !WEEKLY_DEBIT_PLANS.has(plan));
}

export const MINIMUM_SPLIT_WEEKS = 2;
export const MAXIMUM_SPLIT_WEEKS = 12;
/** The split's box takes digits only and stops here (rule 31). */
export const SPLIT_WEEKS_MAX_DIGITS = String(MAXIMUM_SPLIT_WEEKS).length;

/**
 * A charge split into instalments that add back to it exactly: the odd
 * cents go to the first ones, as rent's daily shares do. $100.00 over 3 is
 * $33.34, $33.33, $33.33.
 */
export function instalmentShares(totalCents: number, instalments: number): number[] {
  const base = Math.floor(totalCents / instalments);
  const left = totalCents - base * instalments;
  return Array.from({ length: instalments }, (_, index) => base + (index < left ? 1 : 0));
}

/** Only rent weeks that started this recently are debited (decision 3); older ones stay owing. */
export const DEBIT_LOOKBACK_DAYS = 7;
const DEBIT_LOOKBACK_MS = DEBIT_LOOKBACK_DAYS * MILLISECONDS_PER_DAY;

/**
 * Whether a charged rent week can be debited now: it started in the last
 * 7 days (exact time, not calendar days), after the debits were last
 * resumed, and is not the rental's first week (decision 6: taken at pickup).
 */
export function isRentWeekDebitable(input: {
  weekStartsAt: Date;
  handedOverAt: Date;
  now: Date;
  /** When automatic debits were last resumed, if ever: weeks begun while paused are not debited. */
  resumedAt: Date | null;
}): boolean {
  const startsAt = input.weekStartsAt.getTime();
  const isFirstWeek = startsAt <= input.handedOverAt.getTime();
  const isRecent =
    startsAt <= input.now.getTime() && input.now.getTime() - startsAt < DEBIT_LOOKBACK_MS;
  const isAfterResume = input.resumedAt === null || startsAt >= input.resumedAt.getTime();
  return !isFirstWeek && isRecent && isAfterResume;
}

/** A ledger line with the exact start of the rent period it is for, if any. */
export interface PeriodLedgerLine extends LedgerLineAmount {
  periodStartsAt: Date | null;
}

/**
 * A rent week's rent as it stands: its charge plus any correction added
 * since, less any of them reversed. Never below nothing.
 */
export function rentWeekCents(lines: readonly PeriodLedgerLine[], weekStartsAt: Date): number {
  const ofWeek = lines.filter((line) => line.periodStartsAt?.getTime() === weekStartsAt.getTime());
  const weekIds = new Set(ofWeek.map((line) => line.id));
  const reversals = lines.filter(
    (line) => line.kind === "reversal" && line.reversesId !== null && weekIds.has(line.reversesId),
  );
  return Math.max(ledgerBalanceCents([...ofWeek, ...reversals]), 0);
}

/**
 * What a debit takes: what it was planned from, capped at what is owing on
 * the rental now less its debits still on their way (never more than is
 * owing), or nothing at all when that is under Stripe's 50c minimum.
 */
export function scheduledDebitCents(input: {
  plannedCents: number;
  owingCents: number;
  pendingCents: number;
}): number {
  const room = Math.max(input.owingCents - input.pendingCents, 0);
  const amount = Math.min(input.plannedCents, room);
  return amount >= STRIPE_MINIMUM_CHARGE_CENTS ? amount : 0;
}

/**
 * A rate rise for a Renter paying by direct debit starts at least this many
 * days after they sign (decision 3), so a debit never takes a higher amount
 * without the notice Stripe's Direct Debit Request promises. One constant,
 * so it changes in one place if Stripe confirms a shorter notice.
 */
export const RATE_RISE_NOTICE_DAYS = 30;

export function isRateRise(rateBeforeCents: number | null, rateAfterCents: number): boolean {
  return rateBeforeCents !== null && rateAfterCents > rateBeforeCents;
}

/** The first rent week (as its block) starting at least the notice after `from`. */
export function firstWeekAfterNotice(handedOverAt: Date, from: Date): number {
  const noticeEnds = from.getTime() + RATE_RISE_NOTICE_DAYS * MILLISECONDS_PER_DAY;
  const block = Math.max(Math.ceil((noticeEnds - handedOverAt.getTime()) / BLOCK_MILLISECONDS), 0);
  return Math.ceil(block / DAYS_PER_WEEK) * DAYS_PER_WEEK;
}

/**
 * The rent week a signed rate change starts from: the one it proposed, or
 * for a rise to a Renter paying by direct debit, the first week starting
 * 30 days after they sign, if later (decision 3; decision 7 for a fall).
 */
export function signedRateChangeStartBlock(input: {
  handedOverAt: Date;
  proposedFromBlock: number;
  signedAt: Date;
  needsNotice: boolean;
}): number {
  if (!input.needsNotice) {
    return input.proposedFromBlock;
  }
  return Math.max(
    input.proposedFromBlock,
    firstWeekAfterNotice(input.handedOverAt, input.signedAt),
  );
}

/** The change form's words for a start that may move when signed late. */
export const RATE_RISE_NOTICE_TEXT = `or the first rent week starting ${RATE_RISE_NOTICE_DAYS} days after you sign, if later`;

/** A week's start for Stripe's description, on the business's clock: "Thu 12 Nov 2026". */
function debitDayText(moment: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(AUSTRALIAN_LOCALE, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(moment)
    .replace(",", "");
}

/**
 * What Stripe shows the Renter (and their bank statement) for a debit: the
 * car and the week, never a person's name (decision 9, rule 7), so a
 * business with several cars can match each debit to one.
 */
export function debitDescription(
  debit: { kind: "rent"; weekStartsAt: Date } | { kind: "one_off"; requestedAt: Date },
  rego: string,
  timeZone: string,
): string {
  return debit.kind === "rent"
    ? `Rent ${rego}, week from ${debitDayText(debit.weekStartsAt, timeZone)}`
    : `Charges ${rego}, ${debitDayText(debit.requestedAt, timeZone)}`;
}

/** A request still under way may not have had Stripe's answer yet: recovery leaves it this long. */
export const DEBIT_RECOVERY_WAIT_MS = 15 * MILLISECONDS_PER_MINUTE;
/** Stripe keeps a request's key for at least 24 hours; within this, the same request is asked again. */
export const DEBIT_KEY_REUSE_MS = 23 * 60 * MILLISECONDS_PER_MINUTE;
/** A debit pending this long is read again from Stripe, in case its message was lost. */
export const DEBIT_REREAD_AFTER_MS = 7 * MILLISECONDS_PER_DAY;
/** Our reason for a debit never sent to Stripe: ours, not the Renter's (slice 6 sends no email). */
export const DEBIT_NOT_SENT_CODE = "not_sent";

/** What recovery does with a reserved debit Stripe's answer was never saved for. */
export function debitRecoveryStep(requestedAt: Date, now: Date): "wait" | "ask_again" | "look_up" {
  const age = now.getTime() - requestedAt.getTime();
  if (age < DEBIT_RECOVERY_WAIT_MS) {
    return "wait";
  }
  return age < DEBIT_KEY_REUSE_MS ? "ask_again" : "look_up";
}

/**
 * Stripe's code for a debit refused over the business's BECS limit. To be
 * confirmed in the sandbox run (docs/launch-checklist.md); the reminder in
 * Settings → Payments shows again after one.
 */
export const OVER_LIMIT_FAILURE_CODES: ReadonlySet<string> = new Set([
  "amount_too_large",
  "payment_method_amount_too_large",
]);

/** Stripe's failure codes in plain words; anything else reads as the bank not paying it. */
const DEBIT_FAILURE_TEXTS: Readonly<Record<string, string>> = {
  insufficient_funds: "Not enough money in the account",
  account_closed: "The bank account is closed",
  no_account: "The bank account could not be found",
  debit_not_authorized: "The Renter's bank says the debit was not authorised",
  bank_account_restricted: "The bank account can't take debits",
  [DEBIT_NOT_SENT_CODE]: "Not sent to Stripe",
};
const OVER_LIMIT_TEXT = "Over your Stripe direct-debit limit";
const UNKNOWN_FAILURE_TEXT = "The bank did not pay it";

export function debitFailureText(code: string | null): string {
  if (code && OVER_LIMIT_FAILURE_CODES.has(code)) {
    return OVER_LIMIT_TEXT;
  }
  return (code ? DEBIT_FAILURE_TEXTS[code] : undefined) ?? UNKNOWN_FAILURE_TEXT;
}

/** The BECS-limit reminder shows again for this long after a debit was refused for the limit. */
export const OVER_LIMIT_REMINDER_DAYS = 30;
