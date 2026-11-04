import { describe, expect, it } from "vitest";

import {
  canTakeStripePayments,
  isStripeAccountId,
  paymentAccountState,
  type PaymentAccountStatus,
} from "./payment-accounts";

const READY: PaymentAccountStatus = {
  cardPayments: "active",
  becsDebitPayments: "active",
  requirementsDue: 0,
  requirementsLater: 0,
  isDisconnected: false,
};

describe("a business's Stripe account", () => {
  it("is ready only with cards and direct debit both active and nothing due", () => {
    expect(paymentAccountState(READY)).toBe("ready");
    expect(canTakeStripePayments(paymentAccountState(READY))).toBe(true);
  });

  it("is not connected until there is an account", () => {
    expect(paymentAccountState(null)).toBe("not_connected");
    expect(canTakeStripePayments("not_connected")).toBe(false);
  });

  it("asks for details first, then shows a refusal, then waits for Stripe's checks", () => {
    expect(paymentAccountState({ ...READY, requirementsDue: 2, cardPayments: "restricted" })).toBe(
      "details_needed",
    );
    expect(paymentAccountState({ ...READY, becsDebitPayments: "rejected" })).toBe("restricted");
    expect(paymentAccountState({ ...READY, cardPayments: "unsupported" })).toBe("restricted");
    expect(paymentAccountState({ ...READY, becsDebitPayments: "pending" })).toBe("in_review");
    for (const state of ["details_needed", "restricted", "in_review"] as const) {
      expect(canTakeStripePayments(state)).toBe(false);
    }
  });

  it("stays ready with things Stripe will only want later (review A5-1)", () => {
    expect(paymentAccountState({ ...READY, requirementsLater: 3 })).toBe("ready");
  });

  it("is disconnected once Stripe closes it or the business disconnects, whatever it said before", () => {
    expect(paymentAccountState({ ...READY, isDisconnected: true })).toBe("disconnected");
    expect(paymentAccountState({ ...READY, requirementsDue: 1, isDisconnected: true })).toBe(
      "disconnected",
    );
    expect(canTakeStripePayments("disconnected")).toBe(false);
  });

  it("knows a connected account's ID", () => {
    expect(isStripeAccountId("acct_1AbCdEf234")).toBe(true);
    expect(isStripeAccountId("cus_123")).toBe(false);
    expect(isStripeAccountId("acct_1; drop")).toBe(false);
  });
});
