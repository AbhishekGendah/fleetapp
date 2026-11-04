import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { openRentalPage, rentalOutAndCharged, runNightly } from "./money-steps";
import { expectNoSidewaysScroll } from "./phone-checks";
import type { RentalParties } from "./rental-steps";
import { recordReturn } from "./test-records";

/**
 * A long-term rental back before the long-term minimum: the daily run
 * re-prices it at the daily rate, and the business waives that from the
 * Money card with a reason.
 */
const RENTER = { name: "Wade Waiver", email: "wade.waiver@example.test", phone: "0412001002" };
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: "E2E1002" };

let rentalId = "";

test.describe.serial("waiving the daily rate", () => {
  test("sets up a long-term rental back after a day, and the run re-prices it", async ({
    page,
  }) => {
    rentalId = await rentalOutAndCharged(page, RENTER, PARTIES);
    await recordReturn(rentalId);
    await runNightly(page);
  });

  test.describe("on the Operator's phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("waives the daily rate from the keyboard, and the button goes", async ({ page }) => {
      await openRentalPage(page, rentalId, PARTIES);
      await expect(page.getByText(/at the daily rate: back after 1 days?/).first()).toBeVisible();
      const waive = page.getByRole("button", { name: "Waive the daily rate" });
      await expectNoSidewaysScroll(page);

      await waive.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      const reason = dialog.getByRole("textbox", { name: /^Why is the daily rate waived/ });
      await expect(reason).toBeVisible();
      await expectAccessible(page);
      await reason.fill("Regular Renter");
      await dialog.getByRole("button", { name: "Waive the daily rate" }).click();

      await expect(dialog).toBeHidden();
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByText(/daily rate waived$/).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Waive the daily rate" })).toHaveCount(0);
    });
  });
});
