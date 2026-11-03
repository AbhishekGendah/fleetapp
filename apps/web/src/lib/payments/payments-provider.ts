import type { PaymentAccountStatus } from "@fleetapp/core";

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
}
