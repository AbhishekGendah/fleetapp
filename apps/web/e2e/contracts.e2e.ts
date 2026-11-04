import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectPdf } from "./pdf-checks";
import { expectNoSidewaysScroll } from "./phone-checks";

/**
 * Contract templates as an Operator writes them: add one from the starter
 * layout, edit it (formatting and a merge field), save a new version and
 * preview it as a PDF.
 */
const TEMPLATE_NAME = "Standard contract";
/** A second template, emptied to show the missing rent terms warning. */
const BARE_TEMPLATE_NAME = "Contract without rent terms";
/**
 * The editor page's JavaScript, compressed: what it downloads today
 * (1 Nov 2026, with TipTap) plus about 10%. Its address holds the template's
 * id, so it is checked here rather than in download-size.e2e.ts.
 */
const EDITOR_PAGE_BUDGET_KB = 640;

test.describe.serial("contract templates", () => {
  test("adds a template from the starter layout and opens it in the editor", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Contract templates" }).click();
    await expect(page.getByRole("heading", { name: "Contracts", level: 1 })).toBeVisible();

    await page.getByRole("textbox", { name: /^Name/ }).fill(TEMPLATE_NAME);
    await page.getByRole("button", { name: "Add template" }).click();

    await expect(page.getByRole("heading", { name: TEMPLATE_NAME })).toBeVisible();
    await expect(page.getByText("Used for new rentals").first()).toBeVisible();
    const editor = page.getByRole("textbox", { name: /^Contract text/ });
    await expect(editor).toContainText("Vehicle rental agreement");
    await expectAccessible(page);
    expect(await scriptKilobytes(page)).toBeLessThanOrEqual(EDITOR_PAGE_BUDGET_KB);
  });

  test("saves an edit as a new version, with a field inserted", async ({ page }) => {
    await page.goto("/settings/contracts", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: TEMPLATE_NAME }).click();
    const editor = page.getByRole("textbox", { name: /^Contract text/ });
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Return the car to ");
    await page.getByRole("button", { name: "Insert field" }).click();
    await page.getByRole("menuitem", { name: "Business address" }).click();
    await expect(editor.locator('[data-merge-field="businessAddress"]').last()).toBeVisible();

    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByText(/^Saved as a new version/)).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText(/^Version 2:/)).toBeVisible();
    await expect(page.getByText(/^Version 1:/)).toBeVisible();
    await expect(editor).toContainText("Return the car to");
  });

  test("previews the template as a PDF, kept out of any cache", async ({ page }) => {
    await page.goto("/settings/contracts", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: TEMPLATE_NAME }).click();

    const preview = page.getByRole("link", { name: "Preview as PDF" });
    await expectPdf(page, await preview.getAttribute("href"));
  });

  test.describe("at phone width", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("the editor fits the screen", async ({ page }) => {
      await page.goto("/settings/contracts", { waitUntil: "networkidle" });
      await page.getByRole("link", { name: TEMPLATE_NAME }).click();
      await expect(page.getByRole("textbox", { name: /^Contract text/ })).toBeVisible();
      await expectNoSidewaysScroll(page);
    });
  });

  test("warns when a contract no longer states how rent is charged", async ({ page }) => {
    // A template of its own: the one used for new rentals stays whole for the rentals tests.
    await page.goto("/settings/contracts", { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: /^Name/ }).fill(BARE_TEMPLATE_NAME);
    await page.getByRole("button", { name: "Add template" }).click();
    await expect(page.getByRole("heading", { name: BARE_TEMPLATE_NAME })).toBeVisible();
    await expect(page.getByText(/does not state how rent is charged/)).toHaveCount(0);

    const editor = page.getByRole("textbox", { name: /^Contract text/ });
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Rent is whatever we say.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/^Saved as a new version/)).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    const warning = page.getByRole("status").filter({ hasText: "does not state how rent" });
    await expect(warning).toContainText("Grace period at the return");
    await expect(warning).toContainText("Long-term minimum");
    await expectAccessible(page);
  });
});
