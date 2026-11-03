import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createStripeProvider } = await import("../src/lib/payments/stripe-provider");

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
