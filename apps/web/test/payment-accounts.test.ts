import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import {
  handlePaymentEvent,
  loadPaymentAccount,
  refreshPaymentAccount,
  startStripeOnboarding,
  type PaymentDependencies,
} from "../src/lib/payments/payment-accounts";
import { createStandInPayments, type StandInPayments } from "../src/lib/payments/stand-in-provider";
import { seedOperatorWithUser } from "./car-fixtures";

const WEBHOOK_SECRET = "whsec_test_only";
const URLS = {
  returnUrl: "https://app.example.test/settings/payments",
  refreshUrl: "https://app.example.test/settings/payments/connect",
};
const ACCOUNT_UPDATED = "v2.core.account[configuration.merchant].capability_status_updated";

/**
 * A business's own Stripe account (slice 3): made once, its status always
 * Stripe's word; events signed, matched to a business by account only
 * (rule 3), handled once (rule 20); and each business's account its own.
 */
describe("connecting Stripe", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let stripe: StandInPayments;
  let actor: ActingUser;
  let otherOperator: ActingUser;
  let eventNumber = 0;

  function deps(): PaymentDependencies {
    return { database: web.db, payments: stripe, now: () => new Date() };
  }

  function sendEvent(accountId: string | null, type = ACCOUNT_UPDATED) {
    eventNumber += 1;
    const event = stripe.signedEvent({
      id: `evt_test_${eventNumber}_${Date.now()}`,
      type,
      accountId,
    });
    return { event, handled: handlePaymentEvent(deps(), event.payload, event.signature) };
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    stripe = createStandInPayments(WEBHOOK_SECRET);
    actor = await seedOperatorWithUser(admin, "Payments Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Payments Rentals Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("makes the business's account once, and sends it to Stripe's onboarding", async () => {
    expect(await loadPaymentAccount(web.db, actor.operatorId)).toBeNull();

    const first = await startStripeOnboarding(deps(), actor, URLS);
    const again = await startStripeOnboarding(deps(), actor, URLS);

    const account = await loadPaymentAccount(web.db, actor.operatorId);
    expect([first, again]).toEqual([URLS.returnUrl, URLS.returnUrl]);
    expect(account?.stripeAccountId).toMatch(/^acct_/);
    expect(account?.isLive).toBe(false);
  });

  it("reads the account's state from Stripe, never from the browser", async () => {
    const account = (await loadPaymentAccount(web.db, actor.operatorId))!;
    stripe.setStatus(account.stripeAccountId, {
      cardPayments: "active",
      becsDebitPayments: "pending",
      requirementsDue: 0,
    });

    expect(await refreshPaymentAccount(deps(), actor.operatorId)).toBe("in_review");
    expect((await loadPaymentAccount(web.db, actor.operatorId))?.state).toBe("in_review");
    expect(await refreshPaymentAccount(deps(), otherOperator.operatorId)).toBe("not_connected");
  });

  it("takes a signed event about the account once, and updates what it can do", async () => {
    const account = (await loadPaymentAccount(web.db, actor.operatorId))!;
    stripe.setStatus(account.stripeAccountId, {
      cardPayments: "active",
      becsDebitPayments: "active",
      requirementsDue: 0,
    });

    const { event, handled } = sendEvent(account.stripeAccountId);
    expect(await handled).toBe("handled");
    expect(await handlePaymentEvent(deps(), event.payload, event.signature)).toBe("repeat");
    expect((await loadPaymentAccount(web.db, actor.operatorId))?.state).toBe("ready");
  });

  it("refuses a bad signature, and leaves an event about no business's account", async () => {
    const { event } = sendEvent(null);
    expect(await handlePaymentEvent(deps(), event.payload, "not-the-signature")).toBe("refused");
    expect(await handlePaymentEvent(deps(), `${event.payload} `, event.signature)).toBe("refused");
    expect(await sendEvent("acct_1NobodysAccount").handled).toBe("ignored");
    expect(await sendEvent(null).handled).toBe("ignored");
  });

  it("keeps each business's account to itself", async () => {
    await startStripeOnboarding(deps(), otherOperator, URLS);
    const ours = (await loadPaymentAccount(web.db, actor.operatorId))!;
    const theirs = (await loadPaymentAccount(web.db, otherOperator.operatorId))!;
    stripe.setStatus(theirs.stripeAccountId, {
      cardPayments: "rejected",
      becsDebitPayments: "rejected",
      requirementsDue: 0,
    });

    // An event about the other business's account changes only theirs.
    expect(await sendEvent(theirs.stripeAccountId).handled).toBe("handled");
    expect(theirs.stripeAccountId).not.toBe(ours.stripeAccountId);
    expect((await loadPaymentAccount(web.db, otherOperator.operatorId))?.state).toBe("restricted");
    expect((await loadPaymentAccount(web.db, actor.operatorId))?.state).toBe("ready");
  });
});
