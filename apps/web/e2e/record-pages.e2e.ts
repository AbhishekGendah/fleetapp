import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import { addCarToBook, addRenter } from "./rental-steps";

/**
 * Record pages no other browser test opened (batch 7, review A10-9): a car's
 * and a Renter's edit pages, Stripe's "Taking you back" page, Settings →
 * Charges with a type archived and brought back, and each page's own tab name.
 */
const CAR_REGO = "REC001";
const RENTER = { name: "Rec Ord", phone: "0412 000 111", email: "rec.ord@example.test" };

test.describe.serial("record pages", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("a car's page is named by its rego, and its edit page works at phone width", async ({
    page,
  }) => {
    await addCarToBook(page, CAR_REGO);
    await expect(page).toHaveTitle(new RegExp(`^${CAR_REGO} · `));
    await page.goto(`${new URL(page.url()).pathname}/edit`, { waitUntil: "networkidle" });
    await expect(page.getByRole("textbox", { name: /^Rego/ })).toHaveValue(CAR_REGO);
    await expectAccessible(page);
    await expectNoSidewaysScroll(page);
  });

  test("a Renter's page never names them in the tab, and its edit page works", async ({ page }) => {
    await addRenter(page, RENTER);
    const title = await page.title();
    expect(title).not.toContain(RENTER.name);
    expect(title.startsWith("Renter · ")).toBe(true);
    await page.goto(`${new URL(page.url()).pathname}/edit`, { waitUntil: "networkidle" });
    await expect(page.getByRole("textbox", { name: /^Full name/ })).toHaveValue(RENTER.name);
    await expectAccessible(page);
    await expectNoSidewaysScroll(page);
  });

  test("the page Stripe sends the Renter back to", async ({ page }) => {
    await page.goto("/r/back", { waitUntil: "networkidle" });
    await expectAccessible(page);
    await expectNoSidewaysScroll(page);
  });

  test("archives a charge type and brings it back, by keyboard (review G4-4)", async ({ page }) => {
    await page.goto("/settings/charges", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Add a charge type" }).click();
    const dialog = page.getByRole("dialog", { name: /charge type/i });
    await dialog.getByRole("textbox", { name: /^Name/ }).fill("Car seat hire");
    await dialog.getByRole("button", { name: "Add charge type" }).click();
    const type = page.getByRole("list", { name: "Charge types" }).getByRole("listitem").filter({
      hasText: "Car seat hire",
    });
    await type.getByRole("button", { name: "Archive" }).click();
    const archived = page.getByRole("list", { name: "Archived charge types" });
    const bringBack = archived.getByRole("button", { name: "Bring back Car seat hire" });
    await bringBack.focus();
    await page.keyboard.press("Enter");
    await expect(type).toBeVisible();
    await expect(bringBack).toHaveCount(0);
    await expectAccessible(page);
  });
});
