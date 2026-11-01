import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { test } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";

/**
 * Every admin page the browser tests reach, checked by axe-core against
 * WCAG 2.2 AA, on a computer and at phone width.
 */
const PAGES = ["/", "/components", "/operators", "/operators/new", "/car-models"] as const;

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

  test("the sign-in page has no accessibility problems", async ({ page }) => {
    await page.goto("/sign-in", { waitUntil: "networkidle" });
    await expectAccessible(page);
  });
});
