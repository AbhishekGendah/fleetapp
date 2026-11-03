import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test, type Page } from "@playwright/test";

import { E2E_CRON_SECRET, PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import {
  addCarToBook,
  fillRental,
  morningInDays,
  rentalIdOnPage,
  type RentalParties,
} from "./rental-steps";
import { recordHandover, recordSignedContract } from "./test-records";

/**
 * A rental's money on the Operator's phone: rent added by the daily run
 * from the handover, a one-off charge, a payment received, a mistake
 * reversed; the Renter's whole ledger; and Settings → Charges.
 */
const RENTER = { name: "Mia Money", email: "mia.money@example.test" };
const CAR_REGO = "E2E1001";
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: CAR_REGO };
/** The rental page's JavaScript, compressed: as in changes.e2e.ts. */
const RENTAL_PAGE_BUDGET_KB = 400;

let rentalId = "";

async function openRental(page: Page): Promise<void> {
  await page.goto(`/rentals/${rentalId}`, { waitUntil: "networkidle" });
  await rentalIdOnPage(page, PARTIES);
}

test.describe.serial("a rental's money", () => {
  test("sets up a rental handed over yesterday, and the daily run charges its rent", async ({
    page,
  }) => {
    await page.goto("/renters/new", { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: /^Full name/ }).fill(RENTER.name);
    await page.getByRole("textbox", { name: /^Phone/ }).pressSequentially("0412001001");
    await page.getByRole("textbox", { name: /^Email/ }).fill(RENTER.email);
    await page.getByRole("button", { name: "Add Renter" }).click();
    await expect(page.getByRole("heading", { name: RENTER.name })).toBeVisible();
    await addCarToBook(page, CAR_REGO);
    await fillRental(page, PARTIES, morningInDays(2), morningInDays(30));
    await page.getByRole("button", { name: "Book", exact: true }).click();
    rentalId = await rentalIdOnPage(page, PARTIES);
    await recordSignedContract(rentalId);
    await recordHandover(rentalId);

    const run = await page.request.get("/api/cron/rent", {
      headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
    });
    expect(run.ok()).toBe(true);
    const refused = await page.request.get("/api/cron/rent");
    expect(refused.status()).toBe(401);
  });

  test.describe("on the Operator's phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("shows the rent owing, and adds a charge and a payment", async ({ page }) => {
      await openRental(page);
      await expect(page.getByRole("heading", { name: "Money", exact: true })).toBeVisible();
      await expect(page.getByText(/^Owing \$/).first()).toBeVisible();
      await expect(page.getByText(/^(Part-week|Weekly) rent$/).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await scriptKilobytes(page)).toBeLessThanOrEqual(RENTAL_PAGE_BUDGET_KB);
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      await page.getByRole("button", { name: "Add charge" }).click();
      const charge = page.getByRole("dialog");
      await charge.getByRole("button", { name: "Add charge" }).click();
      await expect(charge.getByLabel(/^What for/)).toBeFocused();
      await charge.getByLabel(/^What for/).selectOption({ label: "Cleaning" });
      await charge.getByRole("textbox", { name: /^Amount/ }).pressSequentially("80");
      await expect(charge.getByRole("textbox", { name: /^Amount/ })).toHaveValue("$80");
      await charge.getByRole("textbox", { name: /^Description/ }).fill("Seats cleaned");
      await expectAccessible(page);
      await charge.getByRole("button", { name: "Add charge" }).click();
      await expect(charge).toBeHidden();
      await expect(page.getByText("Seats cleaned")).toBeVisible();

      // From the keyboard: the payment form opens with what is owing filled in.
      await page.getByRole("button", { name: "Record payment" }).focus();
      await page.keyboard.press("Enter");
      const payment = page.getByRole("dialog");
      await expect(payment.getByRole("textbox", { name: /^Amount/ })).not.toHaveValue("");
      await payment.getByRole("textbox", { name: /^Amount/ }).fill("");
      await payment.getByRole("textbox", { name: /^Amount/ }).pressSequentially("50");
      await payment.getByLabel(/^How/).selectOption("cash");
      await payment.getByRole("textbox", { name: /^Reference/ }).fill("rcpt-9");
      await expect(payment.getByRole("textbox", { name: /^Reference/ })).toHaveValue("RCPT-9");
      await payment.getByRole("button", { name: "Record payment" }).click();
      await expect(payment).toBeHidden();
      await expect(page.getByText("Reference RCPT-9")).toBeVisible();
      await expect(page.getByText("−$50.00")).toBeVisible();
    });

    test("reverses a mistake, which stays in the list cancelled out", async ({ page }) => {
      await openRental(page);
      const cleaning = page.getByRole("listitem").filter({ hasText: "Seats cleaned" }).first();
      await cleaning.getByRole("button", { name: "Reverse" }).click();
      const reverse = page.getByRole("dialog");
      await reverse
        .getByRole("textbox", { name: /^Why is it being reversed/ })
        .fill("Charged by mistake");
      await expectAccessible(page);
      await reverse.getByRole("button", { name: "Reverse this line" }).click();
      await expect(reverse).toBeHidden();
      await expect(cleaning.getByText("Reversed", { exact: true })).toBeVisible();
      await expect(page.getByText("Charged by mistake")).toBeVisible();
      await expect(cleaning.getByRole("button", { name: "Reverse" })).toHaveCount(0);
    });

    test("the Renter's Money tab has every line, with the car", async ({ page }) => {
      await page.goto("/renters", { waitUntil: "networkidle" });
      await page
        .getByRole("link", { name: new RegExp(RENTER.name) })
        .first()
        .click();
      await page.getByRole("link", { name: "Money", exact: true }).click();
      await expect(page.getByText(/^Owing \$/)).toBeVisible();
      await expect(page.getByText(new RegExp(`· ${CAR_REGO}$`)).first()).toBeVisible();
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
    });

    test("Settings → Charges sets a type's GST and adds and archives the business's own", async ({
      page,
    }) => {
      await page.goto("/settings", { waitUntil: "networkidle" });
      await page.getByRole("link", { name: "Charge types" }).click();
      await expect(page.getByRole("heading", { name: "Charges", exact: true })).toBeVisible();
      // Its download budget is in download-size.e2e.ts, with the other Settings pages.
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      const toll = page.getByRole("listitem").filter({ hasText: "Toll" }).first();
      await toll.getByRole("button", { name: "Change GST" }).click();
      await page.getByRole("dialog").getByLabel(/^GST/).selectOption("no_gst");
      await page.getByRole("dialog").getByRole("button", { name: "Save GST" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(toll.getByText(/^Not subject to GST/)).toBeVisible();

      await page.getByRole("button", { name: "Add a charge type" }).click();
      const add = page.getByRole("dialog");
      await add.getByRole("textbox", { name: /^Name/ }).fill("Fuel top-up");
      await add.getByLabel(/^GST/).selectOption("taxable");
      await expectAccessible(page);
      await add.getByRole("button", { name: "Add charge type" }).click();
      await expect(add).toBeHidden();
      const fuel = page.getByRole("listitem").filter({ hasText: "Fuel top-up" });
      await expect(fuel).toBeVisible();
      await fuel.getByRole("button", { name: "Archive" }).click();
      await expect(page.getByRole("listitem").filter({ hasText: "Fuel top-up" })).toHaveCount(0);
    });
  });
});
