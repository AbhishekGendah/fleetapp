import type { CheckoutPurpose, PaymentAccountStatus, StripePaymentMethod } from "@fleetapp/core";

/** What a business's new Stripe account starts with: its name and email, nothing more. */
export interface NewPaymentAccount {
  operatorId: string;
  businessName: string;
  email: string | null;
}

/** Where Stripe's own onboarding sends the business back to. */
export interface OnboardingUrls {
  /** When they finish or leave: the status is then read from Stripe, never assumed. */
  returnUrl: string;
  /** When the link has expired or been used: a fresh one is made there. */
  refreshUrl: string;
}

/** An event Stripe sent, once its signature is proven: what it is and which account it is about. */
export interface PaymentEventNotice {
  id: string;
  type: string;
  /** The connected account it is about, if any. */
  accountId: string | null;
  /** The ID of the thing it is about (a Checkout session, a mandate), if any. */
  objectId: string | null;
  /** When it happened at Stripe: what a bond paid is dated by (review A11-10). */
  occurredAt: Date;
}

/** A Renter as a customer on the business's account: a name and email, nothing more. */
export interface NewCustomer {
  renterId: string;
  name: string;
  email: string | null;
}

/** What a visit to Stripe's page is for and where it comes back to (APP_URL, never typed in). */
export interface CheckoutRequest {
  customerId: string;
  /** Who and what it is for, carried by Stripe and given back with the result. */
  reference: CheckoutReference;
  successUrl: string;
  cancelUrl: string;
  /** When Stripe stops accepting the page (review KS-1). */
  expiresAt: Date;
  /** For a bond: the amount, in cents, and the line Stripe shows. */
  payment: { amountCents: number; description: string } | null;
}

/** What a Checkout session is about, as we told Stripe. */
export interface CheckoutReference {
  purpose: CheckoutPurpose;
  rentalId: string;
  renterId: string;
  linkId: string;
}

/** What Stripe says came of a visit to its page, read from Stripe itself. */
export interface CheckoutOutcome {
  sessionId: string;
  /** Null when the metadata is not ours: the session is then ignored. */
  reference: CheckoutReference | null;
  isComplete: boolean;
  /** Stripe no longer accepts it: its time ran out, or we expired it. */
  isExpired: boolean;
  /** A direct debit set up: Stripe's IDs and the mandate's status, as Stripe words it. */
  setup: {
    setupIntentId: string;
    paymentMethodId: string;
    mandateId: string;
    mandateStatus: string;
    /** When the Renter set it up: the newest one set up is the current one (review KS-2). */
    setUpAt: Date;
  } | null;
  /** A payment: how, how much, and whether the money is in yet. */
  payment: {
    paymentIntentId: string;
    method: StripePaymentMethod;
    amountCents: number;
    status: "paid" | "processing" | "failed";
    failureCode: string | null;
  } | null;
}

/**
 * Money going back to the Renter through Stripe: a refund the business
 * made in its Stripe dashboard, or a dispute with the Renter's bank.
 */
export interface MoneyTakenBack {
  /** Stripe's refund (re_… or pyr_…) or dispute (du_…) ID. */
  objectId: string;
  /** The payment it takes back from. */
  paymentIntentId: string;
  amountCents: number;
  /**
   * For a refund: "taken" while it is on its way or done, "failed" if Stripe
   * could not make it. For a dispute: "taken" once the bank withdrew the
   * money, "returned" once it was given back to the business.
   */
  status: "taken" | "failed" | "returned";
}

/**
 * Everything the app asks of Stripe, so every test runs against a
 * stand-in and nothing but this interface knows Stripe's shapes.
 */
export interface PaymentsProvider {
  /** A connected account on the full Stripe dashboard, the business the merchant (decision 1). */
  createAccount(account: NewPaymentAccount): Promise<{ accountId: string; isLive: boolean }>;
  /** A one-time link to Stripe's own onboarding for the account. */
  onboardingLink(accountId: string, urls: OnboardingUrls): Promise<string>;
  /** What Stripe says the account can do now. */
  accountStatus(accountId: string): Promise<PaymentAccountStatus>;
  /** The event, if its signature is Stripe's for this endpoint; null if not. */
  readEvent(payload: string, signature: string): Promise<PaymentEventNotice | null>;
  /** The Renter as a customer on the business's account; the same one each time for a Renter. */
  createCustomer(accountId: string, customer: NewCustomer): Promise<string>;
  /** A visit to Stripe's own page, on the business's account: its ID and address. */
  startCheckout(
    accountId: string,
    request: CheckoutRequest,
  ): Promise<{ sessionId: string; url: string }>;
  /**
   * Stops Stripe accepting a page we opened, so it can't be paid as well as
   * a newer one (review KS-1). One already finished or expired is left as
   * it is: read it to see which.
   */
  expireCheckout(accountId: string, sessionId: string): Promise<void>;
  /** What came of a visit, from Stripe. */
  readCheckout(accountId: string, sessionId: string): Promise<CheckoutOutcome>;
  /** A direct debit's status now, as Stripe words it. */
  readMandateStatus(accountId: string, mandateId: string): Promise<string>;
  /**
   * Cancels a replaced direct debit at Stripe by detaching its bank account
   * from the Renter (Stripe's documented way; review KS-3). Done already
   * counts as done.
   */
  detachPaymentMethod(accountId: string, paymentMethodId: string): Promise<void>;
  /** A refund as Stripe has it now (review A5-4). */
  readRefund(accountId: string, refundId: string): Promise<MoneyTakenBack>;
  /** A dispute as Stripe has it now, with what the latest event says happened to its money. */
  readDispute(
    accountId: string,
    disputeId: string,
    moneyMoved: "withdrawn" | "reinstated",
  ): Promise<MoneyTakenBack>;
  /** Tells Stripe the Renter's current name and email (review A5-6). */
  updateCustomer(
    accountId: string,
    customerId: string,
    customer: { name: string; email: string | null },
  ): Promise<void>;
}
