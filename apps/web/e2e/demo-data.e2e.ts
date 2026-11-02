import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll, expectTappableButtons } from "./phone-checks";

/** The whole run: every car, Renter, rental and handover, against the local stand-ins. */
const WHOLE_RUN_MS = 240_000;
const ADD_BUTTON = "Add demo data";

/**
 * The test site's demo data button, used on a phone with the keyboard. It
 * adds its records with DEMO regos and made-up names, which no other
 * browser test looks for.
 */
test.describe.serial("demo data", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("Settings links to it on the test site, and it fits a phone", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Demo data" }).click();
    await expect(
      page.getByRole("heading", { name: /^Fill .* with made-up records$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Steps" }).getByRole("listitem").first(),
    ).toHaveText(/Cars 1 to 10\s*Waiting/);
    await expectTappableButtons(page, [ADD_BUTTON]);
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });

  test("adds everything from the keyboard, then pressing again adds nothing", async ({ page }) => {
    test.setTimeout(2 * WHOLE_RUN_MS);
    await page.goto("/settings/demo-data", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: ADD_BUTTON }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText(/^Done\./, { timeout: WHOLE_RUN_MS });
    await expect(page.getByText("Stopped")).toHaveCount(0);
    await expectAccessible(page);

    await page.getByRole("button", { name: ADD_BUTTON }).click();
    await expect(page.getByRole("status")).toHaveText(/^Done\./, { timeout: WHOLE_RUN_MS });
    const steps = page.getByRole("list", { name: "Steps" }).getByRole("listitem");
    await expect(steps.filter({ hasText: "Already there" })).toHaveCount(await steps.count());

    await page.goto("/cars?search=DEMO01", { waitUntil: "networkidle" });
    await expect(page.getByText("DEMO01").first()).toBeVisible();
  });
});
