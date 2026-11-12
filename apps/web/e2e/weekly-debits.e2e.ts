import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test } from "@playwright/test";

import { E2E_CRON_SECRET, PHONE_VIEWPORT } from "./e2e-settings";
import { connectStripe, openRentalPage, rentalOutAndCharged } from "./money-steps";
import { expectNoSidewaysScroll } from "./phone-checks";
import type { RentalParties } from "./rental-steps";
import { recordDebits } from "./test-records";

/**
 * Weekly debits on the rental page (docs/plans/phase-4-slice-5.md): a debit
 * on its way, one cleared and one bounced; how a one-off charge is
 * collected, each way named with its first day, and the charge waiting for
 * it (docs/plans/one-off-charge-notice.md); pausing and resuming automatic
 * debits; the Record payment warning; the days' notice setting. At phone width, by keyboard, with axe and the page's budget
 * unchanged. The debits themselves are proven against Stripe's stand-in in
 * the app's own tests.
 */
const RENTER = {
  name: "Debbie Debits",
  email: "debbie.debits@example.test",
  phone: "0412005005",
};
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: "E2E5005" };
/** The rental page's budget, as in rental-page.e2e.ts: unchanged by this slice. */
const RENTAL_PAGE_BUDGET_KB = 400;

let rentalId = "";

test.describe.serial("weekly debits on the rental page", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("sets up a long-term rental out, paid by direct debit, and runs the debit run", async ({
    page,
  }) => {
    await connectStripe(page);
    rentalId = await rentalOutAndCharged(page, RENTER, PARTIES);
    await recordDebits(rentalId);
    // The scheduler's call: nothing due for a car out since yesterday (its first week).
    const run = await page.request.get("/api/cron/debits", {
      headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
    });
    expect(run.ok()).toBe(true);
  });

  test("shows each debit with what it was for, its status, fee and the bank's reason", async ({
    page,
  }) => {
    await openRentalPage(page, rentalId, PARTIES, "money");
    await expect(
      page.getByText(/^Debit of \$350\.00 pending since .*not counted as paid/),
    ).toBeVisible();
    await expect(page.getByText(/^Last debit \$350\.00 cleared on /)).toBeVisible();
    const debits = page.getByRole("list", { name: "Debits from the Renter's bank" });
    await expect(debits.getByRole("listitem")).toHaveCount(3);
    await expect(debits).toContainText("Not enough money in the account");
    await expect(debits).toContainText("Stripe fee $1.50");
    await expect(debits).toContainText("Waiting for the bank");
    expect(await scriptKilobytes(page)).toBeLessThanOrEqual(RENTAL_PAGE_BUDGET_KB);
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });

  test("asks how a one-off charge is collected, invoice only unless changed, by keyboard", async ({
    page,
  }) => {
    await openRentalPage(page, rentalId, PARTIES, "money");
    await page.getByRole("button", { name: "Add charge" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add a charge" });
    const collect = dialog.getByLabel(/How to collect it/);
    await expect(collect).toHaveValue("not_debited");
    // Each named with its first day: never before the invoice is emailed and 3 days have run.
    await expect(collect.locator("option")).toHaveText([
      "Invoice only, don't debit",
      /^With the first weekly debit on or after \w{3} \d{1,2} \w{3}$/,
      /^Debit on \w{3} \d{1,2} \w{3}$/,
      /^Split over weekly debits, from \w{3} \d{1,2} \w{3}$/,
    ]);
    await expect(
      dialog.getByText(/The invoice is emailed to them now, and nothing is debited before/),
    ).toBeVisible();
    await collect.selectOption("split");
    const weeks = dialog.getByLabel(/Over how many weekly debits/);
    await weeks.fill("123");
    await expect(weeks).toHaveValue("12");
    await weeks.fill("1");
    await weeks.blur();
    await expect(dialog.getByText("Enter 2 to 12 weeks.")).toBeVisible();
    await weeks.fill("3");
    await dialog.getByLabel(/What for/).selectOption({ label: "Cleaning" });
    await dialog.getByLabel(/Amount/).fill("100");
    await dialog.getByLabel(/Description/).fill("Interior cleaning");
    await expectAccessible(page);
    await dialog.getByRole("button", { name: "Add charge" }).click();
    await expect(
      page.getByText(/^Interior cleaning: split over weekly debits, from \w{3} \d{1,2} \w{3}\.$/),
    ).toBeVisible();
    const line = page
      .getByRole("list", { name: "Money lines" })
      .getByRole("listitem")
      .filter({ hasText: "Interior cleaning" });
    await expect(
      line.getByText(/^Invoice emailed \w{3} \d{1,2} \w{3} · debit on \w{3} \d{1,2} \w{3}$/),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test("lists the one-off charge waiting for its date on the Stripe card", async ({ page }) => {
    await openRentalPage(page, rentalId, PARTIES, "money");
    const debits = page.getByRole("list", { name: "Debits from the Renter's bank" });
    const waiting = debits.getByRole("listitem").filter({ hasText: "Interior cleaning" });
    await expect(waiting).toContainText("One-off charge · Interior cleaning");
    await expect(waiting).toContainText("Waiting");
    await expect(waiting).toContainText(/Split over weekly debits, from \w{3} \d{1,2} \w{3}/);
    await expect(debits.getByRole("listitem")).toHaveCount(4);
    expect(await scriptKilobytes(page)).toBeLessThanOrEqual(RENTAL_PAGE_BUDGET_KB);
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });

  test("warns before a payment is recorded while a debit is on its way", async ({ page }) => {
    await openRentalPage(page, rentalId, PARTIES, "money");
    await page.getByRole("button", { name: "Record payment" }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Record a payment" })
        .getByText(/A debit of \$350\.00 is on its way/),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test("pauses automatic debits with a reason, and resumes them, by keyboard", async ({ page }) => {
    await openRentalPage(page, rentalId, PARTIES, "money");
    await page.getByRole("button", { name: "Pause automatic debits" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Pause automatic debits" });
    await dialog.getByLabel(/Why are they paused/).fill("Payment arrangement until the 20th");
    await expectAccessible(page);
    await dialog.getByRole("button", { name: "Pause automatic debits" }).click();
    await expect(page.getByText("Automatic debits paused.")).toBeVisible();

    await page.getByRole("button", { name: "Resume automatic debits" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Yes, resume" }).click();
    await expect(page.getByRole("button", { name: "Pause automatic debits" })).toBeVisible();
    await expect(page.getByText("Automatic debits paused.")).toHaveCount(0);
  });

  test("Settings → Payments has the one-off default and the note on Stripe's emails", async ({
    page,
  }) => {
    await page.goto("/settings/payments", { waitUntil: "networkidle" });
    await expect(page.getByLabel(/A new one-off charge starts as/)).toHaveValue("not_debited");
    await expect(
      page.getByText(/Leave Stripe's emails to customers about direct debits/),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });

  test("Settings → Payments sets the days' notice: digits only, at least 3, by keyboard", async ({
    page,
  }) => {
    await page.goto("/settings/payments", { waitUntil: "networkidle" });
    const days = page.getByRole("textbox", { name: /Days' notice before a one-off charge/ });
    await expect(days).toHaveValue("3");
    await days.fill("");
    await days.pressSequentially("1x45");
    // Digits only, stopping at two (rule 31).
    await expect(days).toHaveValue("14");
    await days.fill("2");
    await days.blur();
    await expect(page.getByText("Enter a number of days from 3 to 30.")).toBeVisible();
    await expectAccessible(page);
    await days.fill("3");
    const form = page.locator("form").filter({ has: days });
    await form.getByRole("button", { name: "Save" }).focus();
    await page.keyboard.press("Enter");
    await expect(form.getByText("Saved.")).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});
