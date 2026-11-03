import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { accountStatusOf, createStripeProvider } =
  await import("../src/lib/payments/stripe-provider");

const SECRET = "whsec_test_signing_secret";
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

function signed(payload: string): string {
  return new Stripe("sk_test_unused").webhooks.generateTestHeaderString({
    payload,
    secret: SECRET,
  });
}

/** The real Stripe connection's one offline part: proving an event is Stripe's, and reading its account. */
describe("Stripe's events", () => {
  const stripe = createStripeProvider("sk_test_unused", SECRET);

  it("reads a signed account event: its ID, type and the account it is about", async () => {
    const payload = thinEvent({});
    expect(await stripe.readEvent(payload, signed(payload))).toEqual({
      id: "evt_test_thin",
      type: "v2.core.account[requirements].updated",
      accountId: ACCOUNT_ID,
    });
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
