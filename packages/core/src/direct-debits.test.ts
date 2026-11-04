import { describe, expect, it } from "vitest";

import {
  bondPayableOnlineCents,
  bondToCollectCents,
  directDebitState,
  isDirectDebitMissingForHandover,
  isOvertakenMandate,
  mandateStatusOf,
  STRIPE_ID_PATTERNS,
} from "./direct-debits";

describe("a Renter's direct debit", () => {
  it("is not set up when there is nothing, and set up when one is active", () => {
    expect(directDebitState([])).toBe("not_set_up");
    expect(
      directDebitState([
        { status: "inactive", endReason: "replaced" },
        { status: "active", endReason: null },
      ]),
    ).toBe("active");
  });

  it("waits while Stripe checks one, and shows a bank's cancellation", () => {
    expect(directDebitState([{ status: "waiting", endReason: null }])).toBe("waiting");
    expect(directDebitState([{ status: "inactive", endReason: "cancelled" }])).toBe("cancelled");
    // A replaced one with nothing newer is simply not set up.
    expect(directDebitState([{ status: "inactive", endReason: "replaced" }])).toBe("not_set_up");
  });

  it("reads Stripe's mandate statuses, anything unknown as not usable", () => {
    expect(mandateStatusOf("active")).toBe("active");
    expect(mandateStatusOf("pending")).toBe("waiting");
    expect(mandateStatusOf("inactive")).toBe("inactive");
    expect(mandateStatusOf("something_new")).toBe("inactive");
  });
});

describe("a direct debit before handover", () => {
  const RULES = { isRequiredBeforeHandover: true, canTakeStripePayments: true };

  it("is missing until active, when the rules want it", () => {
    expect(isDirectDebitMissingForHandover({ ...RULES, state: "not_set_up" })).toBe(true);
    expect(isDirectDebitMissingForHandover({ ...RULES, state: "waiting" })).toBe(true);
    expect(isDirectDebitMissingForHandover({ ...RULES, state: "cancelled" })).toBe(true);
    expect(isDirectDebitMissingForHandover({ ...RULES, state: "active" })).toBe(false);
  });

  it("never holds up a business not taking payments by Stripe, or one that turned it off", () => {
    expect(
      isDirectDebitMissingForHandover({
        ...RULES,
        canTakeStripePayments: false,
        state: "not_set_up",
      }),
    ).toBe(false);
    expect(
      isDirectDebitMissingForHandover({
        ...RULES,
        isRequiredBeforeHandover: false,
        state: "not_set_up",
      }),
    ).toBe(false);
  });
});

describe("the bond still to collect", () => {
  it("counts what is held and what is on its way, never below nothing", () => {
    expect(bondToCollectCents({ requiredCents: 50_000, heldCents: 0, pendingCents: 0 })).toBe(
      50_000,
    );
    expect(
      bondToCollectCents({ requiredCents: 50_000, heldCents: 20_000, pendingCents: 10_000 }),
    ).toBe(20_000);
    expect(bondToCollectCents({ requiredCents: 50_000, heldCents: 0, pendingCents: 50_000 })).toBe(
      0,
    );
    expect(bondToCollectCents({ requiredCents: 50_000, heldCents: 60_000, pendingCents: 0 })).toBe(
      0,
    );
  });
});

describe("the bond the Renter can pay on Stripe's page", () => {
  it("is what is still to collect, down to Stripe's 50 cent minimum (review KM-2)", () => {
    expect(bondPayableOnlineCents(50_000)).toBe(50_000);
    expect(bondPayableOnlineCents(50)).toBe(50);
    expect(bondPayableOnlineCents(49)).toBe(0);
    expect(bondPayableOnlineCents(0)).toBe(0);
  });
});

describe("which direct debit is current", () => {
  const MONDAY = new Date("2026-11-02T01:00:00Z");
  const TUESDAY = new Date("2026-11-03T01:00:00Z");

  it("is the one set up last, whatever order Stripe tells us in (review KS-2)", () => {
    expect(isOvertakenMandate(MONDAY, [{ setUpAt: TUESDAY }])).toBe(true);
    expect(isOvertakenMandate(TUESDAY, [{ setUpAt: MONDAY }])).toBe(false);
    expect(isOvertakenMandate(MONDAY, [])).toBe(false);
    expect(isOvertakenMandate(MONDAY, [{ setUpAt: MONDAY }])).toBe(false);
  });
});

describe("Stripe's IDs", () => {
  it("are told apart by their shape", () => {
    expect(STRIPE_ID_PATTERNS.customer.test("cus_A1b2")).toBe(true);
    expect(STRIPE_ID_PATTERNS.customer.test("pm_A1b2")).toBe(false);
    expect(STRIPE_ID_PATTERNS.checkoutSession.test("cs_test_a1B2")).toBe(true);
    expect(STRIPE_ID_PATTERNS.mandate.test("mandate_1Ab")).toBe(true);
    expect(STRIPE_ID_PATTERNS.paymentIntent.test("pi_1Ab; drop table")).toBe(false);
  });
});
