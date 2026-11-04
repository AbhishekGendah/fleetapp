/**
 * An Operator's own Stripe account (docs/plans/phase-4.md, slice 3): the
 * Operator is the merchant, on Stripe's full dashboard. We keep only the
 * account's ID and what Stripe says about it, never its details.
 */

/** What Stripe says about one capability of an account, as Stripe words it. */
export const STRIPE_CAPABILITY_STATUSES = [
  "active",
  "pending",
  "rejected",
  "restricted",
  "unsupported",
] as const;
export type StripeCapabilityStatus = (typeof STRIPE_CAPABILITY_STATUSES)[number];

/** How the app connects to Stripe: not yet set up, a stand-in for tests, or Stripe itself. */
export const PAYMENTS_TRANSPORTS = ["off", "stand_in", "stripe"] as const;
export type PaymentsTransport = (typeof PAYMENTS_TRANSPORTS)[number];

/** What the account can do, as Stripe last told us. */
export interface PaymentAccountStatus {
  /** Taking card payments (the bond by card). */
  cardPayments: StripeCapabilityStatus;
  /** Taking BECS direct debits from Renters' bank accounts. */
  becsDebitPayments: StripeCapabilityStatus;
  /** How many things Stripe needs from the business now, or is already overdue for. */
  requirementsDue: number;
  /** How many things Stripe will want later (once the business grows): shown, never blocking. */
  requirementsLater: number;
  /** Stripe closed the account, or the business disconnected it from AGS. */
  isDisconnected: boolean;
}

/** What the app keeps about an account: Stripe's last word, and when it was disconnected, if it was. */
export type StoredPaymentAccount = Omit<PaymentAccountStatus, "isDisconnected"> & {
  disconnectedAt: Date | null;
};

/** The account's status from what the app keeps. */
export function storedAccountStatus(stored: StoredPaymentAccount): PaymentAccountStatus {
  return {
    cardPayments: stored.cardPayments,
    becsDebitPayments: stored.becsDebitPayments,
    requirementsDue: stored.requirementsDue,
    requirementsLater: stored.requirementsLater,
    isDisconnected: stored.disconnectedAt !== null,
  };
}

/** The account's state, in the words the Operator sees. */
export const PAYMENT_ACCOUNT_STATES = [
  "not_connected",
  "details_needed",
  "in_review",
  "ready",
  "restricted",
  "disconnected",
] as const;
export type PaymentAccountState = (typeof PAYMENT_ACCOUNT_STATES)[number];

export const PAYMENT_ACCOUNT_STATE_LABELS: Readonly<Record<PaymentAccountState, string>> = {
  not_connected: "Not connected",
  details_needed: "Stripe needs more details",
  in_review: "Stripe is checking your details",
  ready: "Ready: cards and direct debit on",
  restricted: "Stripe has limited this account",
  disconnected: "Disconnected from Stripe",
};

const REFUSED: ReadonlySet<StripeCapabilityStatus> = new Set([
  "rejected",
  "restricted",
  "unsupported",
]);

/**
 * The account's state: ready only when Stripe has both card payments and
 * BECS direct debit active. Anything Stripe still needs comes first, then
 * a refusal, then waiting for Stripe's checks. Things Stripe will want only
 * later never switch payments off (review A5-1). A disconnected account is
 * never ready, whatever it last said.
 */
export function paymentAccountState(status: PaymentAccountStatus | null): PaymentAccountState {
  if (!status) {
    return "not_connected";
  }
  if (status.isDisconnected) {
    return "disconnected";
  }
  if (status.requirementsDue > 0) {
    return "details_needed";
  }
  const capabilities = [status.cardPayments, status.becsDebitPayments];
  if (capabilities.some((capability) => REFUSED.has(capability))) {
    return "restricted";
  }
  return capabilities.every((capability) => capability === "active") ? "ready" : "in_review";
}

/** Payments by Stripe are offered only once the account is ready; until then, cash and transfers. */
export function canTakeStripePayments(state: PaymentAccountState): boolean {
  return state === "ready";
}

/** A Stripe connected account's ID, e.g. "acct_1AbC…". */
export const STRIPE_ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9]+$/;

export function isStripeAccountId(value: string): boolean {
  return STRIPE_ACCOUNT_ID_PATTERN.test(value);
}
