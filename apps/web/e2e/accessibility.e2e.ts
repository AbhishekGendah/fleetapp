import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { test } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";

/**
 * Every Operator app page the browser tests reach without a record, checked
 * by axe-core against WCAG 2.2 AA, on a computer and at phone width. Record
 * pages (a car, a Renter, a Renter's link) are checked in their own tests.
 */
const PAGES = [
  "/",
  "/cars",
  "/cars/new",
  "/cars/insurance",
  "/renters",
  "/renters/new",
  "/settings",
] as const;

for (const path of PAGES) {
  test(`${path} has no accessibility problems`, async ({ page }) => {
    await page.goto(path, { waitUntil: "networkidle" });
    await expectAccessible(page);
  });
}

test.describe("at phone width", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  for (const path of PAGES) {
    test(`${path} has no accessibility problems`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      await expectAccessible(page);
    });
  }
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of ["/sign-in", "/forgot-password"]) {
    test(`${path} has no accessibility problems`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      await expectAccessible(page);
    });
  }
});
