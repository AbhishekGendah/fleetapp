import type { PaymentMethod } from "./bonds";

/**
 * A Renter's direct debit and the payments they make through Stripe
 * (docs/plans/phase-4.md, slice 4). The Renter gives their bank or card
 * details on Stripe's own page, on the business's Stripe account; we keep
 * only Stripe's IDs and the method type (rules 7 and 16).
 */

/** The methods a Renter can authorise ongoing debits with: BECS now, PayTo later (rule 16). */
export const MANDATE_METHODS = ["becs_debit"] as const satisfies readonly PaymentMethod[];
export type MandateMethod = (typeof MANDATE_METHODS)[number];

/** How a Renter pays through Stripe's page: by card, or a debit from their bank. */
export const STRIPE_PAYMENT_METHODS = [
  "card",
  "becs_debit",
] as const satisfies readonly PaymentMethod[];
export type StripePaymentMethod = (typeof STRIPE_PAYMENT_METHODS)[number];

/**
 * A direct debit authority (Stripe's mandate): waiting while Stripe or the
 * bank checks it, active once it can be debited, inactive once cancelled
 * (by the bank or the Renter) or replaced by a newer one.
 */
export const MANDATE_STATUSES = ["waiting", "active", "inactive"] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];

/** Why a direct debit stopped: the Renter's bank or Stripe ended it, or a newer one replaced it. */
export const MANDATE_END_REASONS = ["cancelled", "replaced"] as const;
export type MandateEndReason = (typeof MANDATE_END_REASONS)[number];

/** A payment through Stripe (docs/design/06). It counts only once succeeded (decision 2). */
export const PAYMENT_STATUSES = ["pending", "succeeded", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** What a payment through Stripe is for. Weekly debits ("rent") come with slice 5. */
export const PAYMENT_PURPOSES = ["bond"] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

/** What a visit to Stripe's page is for, carried in the session's metadata. */
export const CHECKOUT_PURPOSES = ["direct_debit", "bond"] as const;
export type CheckoutPurpose = (typeof CHECKOUT_PURPOSES)[number];

/** A visit to Stripe's page we opened: still open, finished by the Renter, or expired. */
export const CHECKOUT_STATUSES = ["open", "complete", "expired"] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

/**
 * How long a Stripe page we open stays payable (Stripe allows 30 minutes
 * to 24 hours): long enough to finish, short enough that yesterday's page
 * can't be paid (review KS-1).
 */
export const CHECKOUT_LIFETIME_MS = 60 * 60 * 1000;

/** The rental's direct debit, as the Operator sees it. */
export const DIRECT_DEBIT_STATES = ["not_set_up", "waiting", "active", "cancelled"] as const;
export type DirectDebitState = (typeof DIRECT_DEBIT_STATES)[number];

export const DIRECT_DEBIT_STATE_LABELS: Readonly<Record<DirectDebitState, string>> = {
  not_set_up: "Not set up",
  waiting: "Waiting for Stripe",
  active: "Set up",
  cancelled: "Cancelled by the bank",
};

export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  pending: "Waiting for the bank",
  succeeded: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

/**
 * The Renter's direct debit from all they have set up: one active wins;
 * otherwise one being checked; otherwise the last one was cancelled.
 */
export function directDebitState(
  mandates: readonly { status: MandateStatus; endReason: MandateEndReason | null }[],
): DirectDebitState {
  if (mandates.some((mandate) => mandate.status === "active")) {
    return "active";
  }
  if (mandates.some((mandate) => mandate.status === "waiting")) {
    return "waiting";
  }
  return mandates.some((mandate) => mandate.endReason === "cancelled") ? "cancelled" : "not_set_up";
}

/**
 * Whether the rental's rules want a working direct debit before the car is
 * handed over and there is none. Only once the business can take payments
 * by Stripe: a business on cash and transfers is never held up by it.
 */
export function isDirectDebitMissingForHandover(input: {
  isRequiredBeforeHandover: boolean;
  canTakeStripePayments: boolean;
  state: DirectDebitState;
}): boolean {
  return input.isRequiredBeforeHandover && input.canTakeStripePayments && input.state !== "active";
}

/** The bond the Renter can still be asked to pay: what is held and what is on its way both count. */
export function bondToCollectCents(input: {
  requiredCents: number;
  heldCents: number;
  pendingCents: number;
}): number {
  return Math.max(input.requiredCents - input.heldCents - input.pendingCents, 0);
}

/** Stripe takes no payment under 50 cents (AUD), so a smaller bond remainder is left to the business. */
export const STRIPE_MINIMUM_CHARGE_CENTS = 50;

/** The bond the Renter can pay on Stripe's page: what is still to collect, if Stripe will take it. */
export function bondPayableOnlineCents(toCollectCents: number): number {
  return toCollectCents >= STRIPE_MINIMUM_CHARGE_CENTS ? toCollectCents : 0;
}

/**
 * Whether a direct debit set up at this time has been overtaken by another
 * the Renter set up later (review KS-2): the newest one set up is always the
 * current one, whatever order Stripe's messages arrive in.
 */
export function isOvertakenMandate(setUpAt: Date, others: readonly { setUpAt: Date }[]): boolean {
  return others.some((other) => other.setUpAt.getTime() > setUpAt.getTime());
}

/** A Stripe mandate's status in our words; anything unknown is treated as not usable. */
export function mandateStatusOf(stripeStatus: string): MandateStatus {
  if (stripeStatus === "active") {
    return "active";
  }
  return stripeStatus === "pending" ? "waiting" : "inactive";
}

/** The shapes of Stripe's IDs the app keeps, so nothing else is ever stored in their place. */
export const STRIPE_ID_PATTERNS = {
  customer: /^cus_[A-Za-z0-9]+$/,
  checkoutSession: /^cs_[A-Za-z0-9_]+$/,
  paymentIntent: /^pi_[A-Za-z0-9]+$/,
  setupIntent: /^seti_[A-Za-z0-9]+$/,
  paymentMethod: /^pm_[A-Za-z0-9]+$/,
  mandate: /^mandate_[A-Za-z0-9]+$/,
} as const;
