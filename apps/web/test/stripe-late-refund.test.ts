import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { loadBondAccount } from "../src/lib/bonds/bond-account";
import { handlePaymentEvent } from "../src/lib/payments/payment-accounts";
import {
  createStandInPayments,
  type SignedEvent,
  type StandInPayments,
} from "../src/lib/payments/stand-in-provider";
import { seedOperatorWithUser } from "./car-fixtures";
import { PAYMENTS_WEBHOOK_SECRET, paymentsTestKit } from "./payment-fixtures";

/** The test rental's bond: $500 (bookTestRental). */
const BOND_CENTS = 500_00;
const REFUND_CENTS = 100_00;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * A refund or dispute whose bond payment we haven't recorded yet, still
 * arriving after the hour (its payment's Checkout message delayed or
 * failing): before, it was taken as handled and lost for good; now it is
 * sent back for Stripe to retry while that payment can still be recorded,
 * and taken off the bond once it is, only once (rule 20).
 */
describe("a refund that comes long before its bond payment is recorded", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let stripe: StandInPayments;
  let actor: ActingUser;
  const kit = paymentsTestKit(() => ({ web, stripe }));

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    stripe = createStandInPayments(PAYMENTS_WEBHOOK_SECRET);
    actor = await seedOperatorWithUser(admin, "Late Refund Rentals Pty Ltd");
    await kit.connectStripe(actor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  /** Stripe's message as it arrives this long after it happened. */
  function deliverAfter(event: SignedEvent, laterMs: number) {
    const now = () => new Date(Date.now() + laterMs);
    return handlePaymentEvent(
      { database: web.db, payments: stripe, now },
      event.payload,
      event.signature,
    );
  }

  function heldOf(rentalId: string): Promise<number> {
    return loadBondAccount(web.db, actor.operatorId, { id: rentalId, bondCents: BOND_CENTS }).then(
      (account) => account.heldCents,
    );
  }

  /** The bond paid on Stripe's page and refunded in part, neither yet recorded. */
  async function paidAndRefunded() {
    const rental = await kit.bookedRental(actor);
    const visit = await kit.openedPaymentsLink(actor, rental.rentalId);
    const sessionId = await kit.visitStripe(visit, "bond");
    const paid = stripe.finishCheckout(sessionId, "card");
    const { event: refund } = stripe.takeBack(sessionId, {
      kind: "refund",
      amountCents: REFUND_CENTS,
    });
    return { rental, paid, refund };
  }

  it("keeps the refund until its payment is recorded, then takes it off once", async () => {
    const { rental, paid, refund } = await paidAndRefunded();
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await deliverAfter(refund, 2 * HOUR_MS)).toBe("not_ready");
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining("waiting for its payment"),
      expect.objectContaining({ hasStripeStopped: false }),
    );
    expect(await kit.deliver(paid)).toBe("handled");
    expect(await deliverAfter(refund, 2 * HOUR_MS)).toBe("handled");
    expect(await deliverAfter(refund, 2 * HOUR_MS)).toBe("repeat");
    expect(await heldOf(rental.rentalId)).toBe(BOND_CENTS - REFUND_CENTS);
  });

  it("never takes it as handled, even once Stripe stops sending it, while the payment can come", async () => {
    const { rental, paid, refund } = await paidAndRefunded();
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await deliverAfter(refund, 4 * DAY_MS)).toBe("not_ready");
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining("waiting for its payment"),
      expect.objectContaining({ hasStripeStopped: true }),
    );
    // Resent from Stripe's dashboard once the payment is recorded: it counts then.
    expect(await kit.deliver(paid)).toBe("handled");
    expect(await deliverAfter(refund, 4 * DAY_MS)).toBe("handled");
    expect(await heldOf(rental.rentalId)).toBe(BOND_CENTS - REFUND_CENTS);
  });

  it("leaves a refund of a payment that was never ours once no bond payment is on its way", async () => {
    const { paid, refund } = await paidAndRefunded();
    expect(await kit.deliver(paid)).toBe("handled");
    const foreign: StandInPayments = {
      ...stripe,
      readRefund: async (accountId, refundId) => ({
        ...(await stripe.readRefund(accountId, refundId)),
        paymentIntentId: "pi_standinmadeinthedashboard",
      }),
    };
    const later = () => new Date(Date.now() + 2 * HOUR_MS);

    expect(
      await handlePaymentEvent(
        { database: web.db, payments: foreign, now: later },
        refund.payload,
        refund.signature,
      ),
    ).toBe("handled");
  });
});
