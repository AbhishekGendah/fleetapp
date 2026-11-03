import { createHmac } from "node:crypto";

import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { E2E_STRIPE_WEBHOOK_SECRET, PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";

/**
 * Settings → Payments on the Operator's phone, against Stripe's stand-in:
 * connecting the business's own account through "Stripe's" onboarding, and
 * the events endpoint refusing anything not signed for it.
 */
const EVENTS_PATH = "/api/stripe/events";

function signedEvent(event: { id: string; type: string; accountId: string | null }) {
  const payload = JSON.stringify(event);
  return {
    data: payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": createHmac("sha256", E2E_STRIPE_WEBHOOK_SECRET)
        .update(payload)
        .digest("hex"),
    },
  };
}

test.describe("payments by Stripe", () => {
  test.describe("on the Operator's phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("connects the business's own Stripe account, from Settings and the keyboard", async ({
      page,
    }) => {
      await page.goto("/settings", { waitUntil: "networkidle" });
      await page.getByRole("link", { name: "Payments", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Payments", exact: true })).toBeVisible();
      await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      await page.getByRole("button", { name: "Connect Stripe" }).focus();
      await page.keyboard.press("Enter");
      // The stand-in's onboarding comes straight back, the details given.
      await expect(page.getByText("Ready: cards and direct debit on")).toBeVisible();
      await expect(page.getByRole("button", { name: /Stripe$/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /Open your Stripe dashboard/ })).toHaveAttribute(
        "target",
        "_blank",
      );
      await expectAccessible(page);
    });
  });

  test("takes only events signed for it", async ({ request }) => {
    const unsigned = await request.post(EVENTS_PATH, { data: "{}" });
    const misSigned = await request.post(EVENTS_PATH, {
      data: "{}",
      headers: { "stripe-signature": "not-it" },
    });
    const elsewhere = await request.post(
      EVENTS_PATH,
      signedEvent({ id: "evt_e2e_1", type: "v2.core.account.updated", accountId: "acct_1Nobody" }),
    );

    expect([unsigned.status(), misSigned.status(), elsewhere.status()]).toEqual([400, 400, 200]);
    expect(await elsewhere.json()).toEqual({ received: "ignored" });
  });
});
