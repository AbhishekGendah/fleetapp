import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import { addCarToBook } from "./rental-steps";

/**
 * Damage found outside a handover or return, on its own page (launch
 * checklist, review A10-9): recorded from the car's Damage tab, opened,
 * checked at phone width, and marked repaired.
 */
const REGO = "DMG001";
const DESCRIPTION = "Scratch on the bonnet";

test.use({ viewport: PHONE_VIEWPORT });

test("records damage from the car's page and marks it repaired on its own page", async ({
  page,
}) => {
  await addCarToBook(page, REGO);
  await page.getByRole("link", { name: "Damage", exact: true }).click();
  await page.getByRole("button", { name: "Record damage" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /^What is damaged/ }).fill(DESCRIPTION);
  await dialog.getByLabel(/^Where on the car/).selectOption({ label: "Bonnet" });
  await dialog.getByRole("button", { name: "Record damage" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("link", { name: new RegExp(DESCRIPTION) }).click();
  await expect(page.getByText(DESCRIPTION).first()).toBeVisible();
  // The record opens in the app without a reload: its tab name follows a moment after.
  await expect(page).toHaveTitle(/^Damage/);
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  await page
    .getByLabel(/^Status/)
    .first()
    .selectOption({ label: "Repaired" });
  await page.getByRole("button", { name: "Save status" }).click();
  await expect(page.getByText("Repaired").first()).toBeVisible();
});
