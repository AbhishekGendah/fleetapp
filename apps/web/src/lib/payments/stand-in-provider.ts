import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { PaymentAccountStatus, StripePaymentMethod } from "@fleetapp/core";
import { z } from "zod";

import { STAND_IN_CHECKOUT_PATH } from "../paths";
import type {
  CheckoutOutcome,
  CheckoutRequest,
  MoneyTakenBack,
  PaymentEventNotice,
  PaymentsProvider,
} from "./payments-provider";

/**
 * Stripe's stand-in for tests and the browser tests (decision 6): accounts
 * kept in memory, onboarding that finishes at once, and events signed with
 * the endpoint's secret the way the tests send them. Never used in
 * production: the app refuses to start with it there.
 */
export interface StandInPayments extends PaymentsProvider {
  /** Sets what "Stripe" says about an account, as a test needs. */
  setStatus(accountId: string, status: PaymentAccountStatus): void;
  /** A test's event, signed as the endpoint expects. */
  signedEvent(
    event: Omit<PaymentEventNotice, "objectId" | "occurredAt"> & {
      objectId?: string | null;
      occurredAt?: Date;
    },
  ): SignedEvent;
  /** A visit to "Stripe's page" as it was started, for its page and the tests. */
  checkout(sessionId: string): StandInCheckout | null;
  /**
   * The Renter finishes on "Stripe's page": a direct debit set up, or a
   * payment by card (paid at once) or bank debit (processing until settled).
   * Gives the event Stripe would send.
   */
  finishCheckout(
    sessionId: string,
    method?: StripePaymentMethod,
    directDebit?: { setUpAt?: Date; mandateStatus?: string },
  ): SignedEvent;
  /** A bank debit clears or bounces, days later (at Stripe, at `occurredAt`). */
  settlePayment(sessionId: string, isPaid: boolean, occurredAt?: Date): SignedEvent;
  /** The Renter's bank cancels a direct debit. */
  cancelMandate(sessionId: string): SignedEvent;
  /** Stripe moves a direct debit on (checked and active, or cancelled), with its message. */
  setMandateStatus(sessionId: string, mandateStatus: string): SignedEvent;
  /**
   * The business refunds a bond payment in its "Stripe dashboard", or the
   * Renter's bank disputes it: gives the event Stripe would send.
   */
  takeBack(
    sessionId: string,
    change: { kind: "refund" | "dispute"; amountCents: number; status?: MoneyTakenBack["status"] },
  ): { event: SignedEvent; objectId: string };
  /** A refund later fails, or a dispute is won and its money returned. */
  settleTakeBack(objectId: string, status: MoneyTakenBack["status"]): SignedEvent;
  /** The name and email "Stripe" has for a customer. */
  customer(customerId: string): { name: string; email: string | null } | null;
  /** The next customer updates fail, as if Stripe were down. */
  failNextCustomerUpdates(count: number): void;
  /** Whether a bank account was detached at "Stripe" (a replaced direct debit cancelled). */
  isDetached(paymentMethodId: string): boolean;
  /** The next detaches fail, as if Stripe were down, so a test can prove the retry. */
  failNextDetaches(count: number): void;
}

export interface SignedEvent {
  payload: string;
  signature: string;
}

export interface StandInCheckout {
  accountId: string;
  request: CheckoutRequest;
  outcome: CheckoutOutcome;
  mandateStatus: string | null;
}

const READY: PaymentAccountStatus = {
  cardPayments: "active",
  becsDebitPayments: "active",
  requirementsDue: 0,
  requirementsLater: 0,
  isDisconnected: false,
};
const JUST_MADE: PaymentAccountStatus = {
  cardPayments: "pending",
  becsDebitPayments: "pending",
  requirementsDue: 1,
  requirementsLater: 0,
  isDisconnected: false,
};

const standInEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  accountId: z.string().nullable(),
  objectId: z.string().nullable().default(null),
  occurredAt: z.coerce.date(),
});

/** A made-up ID in Stripe's shape. */
function standInId(prefix: string): string {
  return `${prefix}_standin${randomUUID().replaceAll("-", "")}`;
}

function signatureOf(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function createStandInPayments(webhookSecret: string): StandInPayments {
  const accounts = new Map<string, PaymentAccountStatus>();
  const madeFor = new Map<string, string>();
  const customers = new Map<string, string>();
  const checkouts = new Map<string, StandInCheckout>();
  const detached = new Set<string>();
  let failingDetaches = 0;
  const takenBack = new Map<
    string,
    MoneyTakenBack & { accountId: string; kind: "refund" | "dispute" }
  >();
  const customerDetails = new Map<string, { name: string; email: string | null }>();
  let failingCustomerUpdates = 0;

  function signed(
    event: Omit<PaymentEventNotice, "objectId" | "occurredAt"> & {
      objectId?: string | null;
      occurredAt?: Date;
    },
  ) {
    const payload = JSON.stringify({
      ...event,
      objectId: event.objectId ?? null,
      occurredAt: (event.occurredAt ?? new Date()).toISOString(),
    });
    return { payload, signature: signatureOf(webhookSecret, payload) };
  }

  function update(sessionId: string, change: (checkout: StandInCheckout) => StandInCheckout) {
    const checkout = checkouts.get(sessionId);
    if (!checkout) {
      throw new Error("No such stand-in checkout.");
    }
    const changed = change(checkout);
    checkouts.set(sessionId, changed);
    return changed;
  }

  function eventFor(
    checkout: StandInCheckout,
    type: string,
    objectId: string,
    occurredAt?: Date,
  ): SignedEvent {
    return signed({
      id: standInId("evt"),
      type,
      accountId: checkout.accountId,
      objectId,
      ...(occurredAt ? { occurredAt } : {}),
    });
  }

  return {
    async createAccount(account) {
      const existing = madeFor.get(account.operatorId);
      const accountId = existing ?? `acct_standin${randomUUID().replaceAll("-", "")}`;
      if (!existing) {
        madeFor.set(account.operatorId, accountId);
        accounts.set(accountId, JUST_MADE);
      }
      return { accountId, isLive: false };
    },
    async onboardingLink(accountId, urls) {
      // Stripe's pages are skipped: the business comes straight back, its details given.
      accounts.set(accountId, READY);
      return urls.returnUrl;
    },
    async accountStatus(accountId) {
      return accounts.get(accountId) ?? JUST_MADE;
    },
    async readEvent(payload, signature) {
      const expected = Buffer.from(signatureOf(webhookSecret, payload));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
        return null;
      }
      return standInEventSchema.parse(JSON.parse(payload));
    },
    async createCustomer(accountId, customer) {
      const key = `${accountId}:${customer.renterId}`;
      const existing = customers.get(key) ?? standInId("cus");
      customers.set(key, existing);
      customerDetails.set(existing, { name: customer.name, email: customer.email });
      return existing;
    },
    async updateCustomer(_accountId, customerId, customer) {
      if (failingCustomerUpdates > 0) {
        failingCustomerUpdates -= 1;
        throw new Error("The stand-in's Stripe is down.");
      }
      customerDetails.set(customerId, customer);
    },
    async readRefund(_accountId, refundId) {
      const refund = takenBack.get(refundId);
      if (!refund) {
        throw new Error("No such stand-in refund.");
      }
      return refund;
    },
    async readDispute(_accountId, disputeId) {
      const dispute = takenBack.get(disputeId);
      if (!dispute) {
        throw new Error("No such stand-in dispute.");
      }
      return dispute;
    },
    takeBack(sessionId, change) {
      const checkout = checkouts.get(sessionId);
      const paymentIntentId = checkout?.outcome.payment?.paymentIntentId;
      if (!checkout || !paymentIntentId) {
        throw new Error("That stand-in checkout took no payment.");
      }
      const objectId = standInId(change.kind === "refund" ? "re" : "du");
      takenBack.set(objectId, {
        objectId,
        paymentIntentId,
        amountCents: change.amountCents,
        status: change.status ?? "taken",
        accountId: checkout.accountId,
        kind: change.kind,
      });
      const type =
        change.kind === "refund" ? "v1.refund.created" : "v1.charge.dispute.funds_withdrawn";
      return { event: eventFor(checkout, type, objectId), objectId };
    },
    settleTakeBack(objectId, status) {
      const existing = takenBack.get(objectId);
      if (!existing) {
        throw new Error("No such stand-in refund or dispute.");
      }
      takenBack.set(objectId, { ...existing, status });
      const type =
        existing.kind === "refund" ? "v1.refund.updated" : "v1.charge.dispute.funds_reinstated";
      return signed({ id: standInId("evt"), type, accountId: existing.accountId, objectId });
    },
    customer(customerId) {
      return customerDetails.get(customerId) ?? null;
    },
    failNextCustomerUpdates(count) {
      failingCustomerUpdates = count;
    },
    async startCheckout(accountId, request) {
      const sessionId = standInId("cs_test");
      checkouts.set(sessionId, {
        accountId,
        request,
        outcome: {
          sessionId,
          reference: request.reference,
          isComplete: false,
          isExpired: false,
          setup: null,
          payment: null,
        },
        mandateStatus: null,
      });
      return {
        sessionId,
        url: new URL(`${STAND_IN_CHECKOUT_PATH}/${sessionId}`, request.successUrl).toString(),
      };
    },
    async expireCheckout(_accountId, sessionId) {
      const checkout = checkouts.get(sessionId);
      if (checkout && !checkout.outcome.isComplete) {
        checkouts.set(sessionId, {
          ...checkout,
          outcome: { ...checkout.outcome, isExpired: true },
        });
      }
    },
    async readCheckout(_accountId, sessionId) {
      const checkout = checkouts.get(sessionId);
      if (!checkout) {
        throw new Error("No such stand-in checkout.");
      }
      return checkout.outcome;
    },
    async readMandateStatus(_accountId, mandateId) {
      const checkout = [...checkouts.values()].find(
        (each) => each.outcome.setup?.mandateId === mandateId,
      );
      return checkout?.mandateStatus ?? "inactive";
    },
    async detachPaymentMethod(_accountId, paymentMethodId) {
      if (failingDetaches > 0) {
        failingDetaches -= 1;
        throw new Error("The stand-in's Stripe is down.");
      }
      detached.add(paymentMethodId);
      for (const [sessionId, checkout] of checkouts) {
        if (checkout.outcome.setup?.paymentMethodId === paymentMethodId) {
          checkouts.set(sessionId, { ...checkout, mandateStatus: "inactive" });
        }
      }
    },
    isDetached(paymentMethodId) {
      return detached.has(paymentMethodId);
    },
    failNextDetaches(count) {
      failingDetaches = count;
    },
    setStatus(accountId, status) {
      accounts.set(accountId, status);
    },
    signedEvent: signed,
    checkout(sessionId) {
      return checkouts.get(sessionId) ?? null;
    },
    finishCheckout(sessionId, method = "card", directDebit = {}) {
      const { outcome } = checkouts.get(sessionId) ?? {};
      if (outcome?.isExpired || outcome?.isComplete) {
        throw new Error("That stand-in checkout is finished or expired: Stripe would refuse it.");
      }
      const mandateStatus = directDebit.mandateStatus ?? "active";
      const finished = update(sessionId, (checkout) => {
        const { payment } = checkout.request;
        return {
          ...checkout,
          mandateStatus: payment ? null : mandateStatus,
          outcome: {
            ...checkout.outcome,
            isComplete: true,
            setup: payment
              ? null
              : {
                  setupIntentId: standInId("seti"),
                  paymentMethodId: standInId("pm"),
                  mandateId: standInId("mandate"),
                  mandateStatus,
                  setUpAt: directDebit.setUpAt ?? new Date(),
                },
            payment: payment
              ? {
                  paymentIntentId: standInId("pi"),
                  method,
                  amountCents: payment.amountCents,
                  status: method === "card" ? "paid" : "processing",
                  failureCode: null,
                }
              : null,
          },
        };
      });
      return eventFor(finished, "v1.checkout.session.completed", sessionId);
    },
    settlePayment(sessionId, isPaid, occurredAt) {
      const settled = update(sessionId, (checkout) => {
        const { payment } = checkout.outcome;
        if (!payment) {
          throw new Error("That stand-in checkout took no payment.");
        }
        return {
          ...checkout,
          outcome: {
            ...checkout.outcome,
            payment: {
              ...payment,
              status: isPaid ? "paid" : "failed",
              failureCode: isPaid ? null : "insufficient_funds",
            },
          },
        };
      });
      const type = isPaid
        ? "v1.checkout.session.async_payment_succeeded"
        : "v1.checkout.session.async_payment_failed";
      return eventFor(settled, type, sessionId, occurredAt);
    },
    cancelMandate(sessionId) {
      return this.setMandateStatus(sessionId, "inactive");
    },
    setMandateStatus(sessionId, mandateStatus) {
      const changed = update(sessionId, (checkout) => ({ ...checkout, mandateStatus }));
      const mandateId = changed.outcome.setup?.mandateId;
      if (!mandateId) {
        throw new Error("That stand-in checkout set up no direct debit.");
      }
      return eventFor(changed, "v1.mandate.updated", mandateId);
    },
  };
}
