import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { accountStatusOf, checkoutOutcomeOf, createStripeProvider } =
  await import("../src/lib/payments/stripe-provider");

const SECRET = "whsec_test_signing_secret";
const CONNECT_SECRET = "whsec_test_connected_accounts";
const ACCOUNT_ID = "acct_1TestConnected";

function thinEvent(changes: Record<string, unknown>): string {
  return JSON.stringify({
    id: "evt_test_thin",
    object: "v2.core.event",
    type: "v2.core.account[requirements].updated",
    livemode: false,
    created: new Date().toISOString(),
    related_object: {
      id: ACCOUNT_ID,
      type: "v2.core.account",
      url: `/v2/core/accounts/${ACCOUNT_ID}`,
    },
    ...changes,
  });
}

function signed(payload: string, secret = SECRET): string {
  return new Stripe("sk_test_unused").webhooks.generateTestHeaderString({ payload, secret });
}

/** The real Stripe connection's one offline part: proving an event is Stripe's, and reading its account. */
describe("Stripe's events", () => {
  const stripe = createStripeProvider("sk_test_unused", [SECRET, CONNECT_SECRET]);

  it("reads a signed account event: its ID, type and the account it is about", async () => {
    const payload = thinEvent({});
    expect(await stripe.readEvent(payload, signed(payload))).toEqual({
      id: "evt_test_thin",
      type: "v2.core.account[requirements].updated",
      accountId: ACCOUNT_ID,
      objectId: ACCOUNT_ID,
    });
  });

  it("reads a business's own event, signed by the second destination: its account and session", async () => {
    const payload = thinEvent({
      type: "v1.checkout.session.completed",
      context: ACCOUNT_ID,
      related_object: {
        id: "cs_test_a1",
        type: "checkout.session",
        url: "/v1/checkout/sessions/cs_test_a1",
      },
    });
    expect(await stripe.readEvent(payload, signed(payload, CONNECT_SECRET))).toMatchObject({
      type: "v1.checkout.session.completed",
      accountId: ACCOUNT_ID,
      objectId: "cs_test_a1",
    });
    expect(await stripe.readEvent(payload, signed(payload, "whsec_someone_else"))).toBeNull();
  });

  it("takes the account from the event's context when it is from a connected account", async () => {
    const payload = thinEvent({
      type: "v2.core.account_person.updated",
      context: ACCOUNT_ID,
      related_object: { id: "person_1", type: "v2.core.account_person", url: "/" },
    });
    expect((await stripe.readEvent(payload, signed(payload)))?.accountId).toBe(ACCOUNT_ID);
  });

  it("refuses an unsigned, mis-signed or changed event", async () => {
    const payload = thinEvent({});
    expect(await stripe.readEvent(payload, "t=1,v1=nonsense")).toBeNull();
    expect(await stripe.readEvent(thinEvent({ id: "evt_other" }), signed(payload))).toBeNull();
  });
});

/** A v2 account as Stripe returns it, cut down to what the app reads. */
function stripeAccount(
  card: Record<string, unknown>,
  becs: Record<string, unknown>,
  entries: { awaiting_action_from: string }[] = [],
) {
  return {
    id: ACCOUNT_ID,
    livemode: false,
    configuration: {
      merchant: { capabilities: { card_payments: card, au_becs_debit_payments: becs } },
    },
    requirements: { entries },
  };
}

describe("a Stripe account's status", () => {
  it("counts only what the business still has to give", () => {
    const status = accountStatusOf(
      stripeAccount({ status: "active" }, { status: "active" }, [
        { awaiting_action_from: "user" },
        { awaiting_action_from: "stripe" },
      ]),
    );
    expect(status).toEqual({
      cardPayments: "active",
      becsDebitPayments: "active",
      requirementsDue: 1,
    });
  });

  it("reads restricted while Stripe is still checking as waiting, and a real restriction as a limit", () => {
    const checking = accountStatusOf(
      stripeAccount(
        {
          status: "restricted",
          status_details: [
            { code: "requirements_pending_verification", resolution: "no_resolution" },
          ],
        },
        {
          status: "restricted",
          status_details: [{ code: "determining_status", resolution: "no_resolution" }],
        },
      ),
    );
    const limited = accountStatusOf(
      stripeAccount(
        {
          status: "restricted",
          status_details: [{ code: "requirements_past_due", resolution: "provide_info" }],
        },
        { status: "active" },
      ),
    );
    expect([checking.cardPayments, checking.becsDebitPayments]).toEqual(["pending", "pending"]);
    expect(limited.cardPayments).toBe("restricted");
  });

  it("treats a capability Stripe has not reported yet as pending", () => {
    expect(accountStatusOf({ id: ACCOUNT_ID, livemode: false })).toEqual({
      cardPayments: "pending",
      becsDebitPayments: "pending",
      requirementsDue: 0,
    });
  });
});

const REFERENCE = {
  purpose: "bond",
  rental_id: "6f1d1a52-4f5e-4c39-9a3e-2d2e9b1b7c01",
  renter_id: "6f1d1a52-4f5e-4c39-9a3e-2d2e9b1b7c02",
  link_id: "6f1d1a52-4f5e-4c39-9a3e-2d2e9b1b7c03",
};

/** A Checkout session as Stripe returns it, cut down to what the app reads. */
function session(changes: Record<string, unknown>) {
  return {
    id: "cs_test_a1",
    status: "complete",
    metadata: REFERENCE,
    setup_intent: null,
    payment_intent: null,
    ...changes,
  };
}

describe("what came of a visit to Stripe's page", () => {
  it("reads a card payment as paid, and a bank debit as on its way", () => {
    const intent = (type: string, status: string) => ({
      id: "pi_1",
      status,
      amount: 500_00,
      payment_method: { type },
      last_payment_error: null,
    });
    expect(
      checkoutOutcomeOf(session({ payment_intent: intent("card", "succeeded") }), null),
    ).toMatchObject({
      isComplete: true,
      reference: { purpose: "bond", rentalId: REFERENCE.rental_id },
      payment: { method: "card", amountCents: 500_00, status: "paid" },
    });
    expect(
      checkoutOutcomeOf(session({ payment_intent: intent("au_becs_debit", "processing") }), null)
        .payment,
    ).toMatchObject({ method: "becs_debit", status: "processing" });
  });

  it("reads a failed debit with Stripe's reason code, and a method we do not take as nothing", () => {
    const failed = {
      id: "pi_1",
      status: "requires_payment_method",
      amount: 500_00,
      payment_method: { type: "au_becs_debit" },
      last_payment_error: { code: "insufficient_funds" },
    };
    expect(checkoutOutcomeOf(session({ payment_intent: failed }), null).payment).toMatchObject({
      status: "failed",
      failureCode: "insufficient_funds",
    });
    const other = { ...failed, status: "succeeded", payment_method: { type: "klarna" } };
    expect(checkoutOutcomeOf(session({ payment_intent: other }), null).payment).toBeNull();
  });

  it("reads a direct debit set up, and ignores a session whose metadata is not ours", () => {
    const setUp = checkoutOutcomeOf(
      session({ setup_intent: { id: "seti_1", payment_method: "pm_1", mandate: "mandate_1" } }),
      "active",
    );
    expect(setUp.setup).toEqual({
      setupIntentId: "seti_1",
      paymentMethodId: "pm_1",
      mandateId: "mandate_1",
      mandateStatus: "active",
    });
    expect(
      checkoutOutcomeOf(session({ metadata: { purpose: "bond" } }), null).reference,
    ).toBeNull();
  });
});
