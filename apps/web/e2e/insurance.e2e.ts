import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import { addCarToBook } from "./rental-steps";

/**
 * An insurance policy from the form to its own page (launch checklist,
 * review A10-9): added covering a car, its number in capitals (rule 31),
 * the car taken off and put back, then archived and restored, at phone width.
 * The ticked car and "Add car" once never reached the server (5 Nov 2026):
 * their field names came from browser-only files.
 */
const REGO = "INS001";
const INSURER = "Example Insurance";

test.use({ viewport: PHONE_VIEWPORT });

test("adds a policy covering a car, and manages it from its own page", async ({ page }) => {
  await addCarToBook(page, REGO, { isPaperworkOnFile: false });

  await page.goto("/cars/insurance/new", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /^Insurer/ }).fill(INSURER);
  const policyNumber = page.getByRole("textbox", { name: /^Policy number/ });
  await policyNumber.fill("pol-123");
  await expect(policyNumber).toHaveValue("POL-123");
  await page.getByLabel(/^Cover/).selectOption({ label: "Comprehensive" });
  await page.getByLabel(/^Starts/).fill("2026-01-01");
  await page.getByLabel(/^Ends/).fill("2026-12-31");
  await page.getByRole("textbox", { name: /^Premium/ }).pressSequentially("1200");
  await page.getByRole("checkbox", { name: new RegExp(`^${REGO}`) }).check();
  await page.getByRole("button", { name: "Add policy" }).click();

  await expect(page.getByRole("heading", { name: INSURER })).toBeVisible();
  await expect(page.getByText(/^POL-123 · Comprehensive/)).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`^${REGO}`) })).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  await page.getByRole("button", { name: "Take off" }).click();
  await expect(page.getByRole("link", { name: new RegExp(`^${REGO}`) })).toHaveCount(0);
  const addCar = page.getByLabel("Add a car to this policy");
  const carOption = (await addCar.locator("option", { hasText: REGO }).textContent()) ?? "";
  await addCar.selectOption({ label: carOption });
  await page.getByRole("button", { name: "Add car" }).click();
  await expect(page.getByRole("link", { name: new RegExp(`^${REGO}`) })).toBeVisible();

  await page.getByRole("button", { name: "Archive this policy" }).click();
  await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Restore this policy" }).click();
  await expect(page.getByRole("button", { name: "Archive this policy" })).toBeVisible();
});
