import { expect, test, type Page } from "@playwright/test";

import { E2E_OPERATORS, MINIMUM_TOUCH_TARGET_PX, PHONE_VIEWPORT } from "./e2e-settings";

/**
 * The shared list, on a real page with real database paging: search, sort,
 * filters by keyboard, and cards at phone width. Written before the list moves
 * to TanStack Table and nuqs (library swap stage 7).
 */
const LIST_PATH = "/operators";
const [ALPHA, BRAVO, CHARLIE] = E2E_OPERATORS;

async function openList(page: Page, query = ""): Promise<void> {
  await page.goto(`${LIST_PATH}${query}`, { waitUntil: "networkidle" });
}

function tableRows(page: Page) {
  return page.getByRole("table").locator("tbody tr");
}

test("searching updates the list without reloading the page", async ({ page }) => {
  await openList(page);
  await page.evaluate(() => {
    (window as Window & { isSamePage?: boolean }).isSamePage = true;
  });
  await page.getByLabel("Search by name or email").fill("charlie");
  await page.keyboard.press("Enter");
  await expect(tableRows(page)).toHaveCount(1);
  expect(await page.evaluate(() => (window as Window & { isSamePage?: boolean }).isSamePage)).toBe(
    true,
  );
});

test("search narrows the list", async ({ page }) => {
  await openList(page);
  await page.getByLabel("Search by name or email").fill("bravo");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/bravo/);
  await expect(tableRows(page)).toHaveCount(1);
  await expect(tableRows(page).first()).toContainText(BRAVO.legalName);
});

test("sorting by a column flips between A to Z and Z to A", async ({ page }) => {
  await openList(page);
  const heading = page.locator("th").filter({ hasText: /^Operator/ });
  const sortLink = heading.getByRole("link");

  await sortLink.click();
  await page.waitForURL(/dir=asc/);
  await expect(heading).toHaveAttribute("aria-sort", "ascending");
  await expect(tableRows(page).first()).toContainText(ALPHA.legalName);

  await sortLink.click();
  await page.waitForURL(/dir=desc/);
  await expect(heading).toHaveAttribute("aria-sort", "descending");
  await expect(tableRows(page).first()).toContainText(CHARLIE.legalName);
});

test("screen readers hear the column headings as headings", async ({ page }) => {
  await openList(page);
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
});

test("a filter waits for Enter when moved through by keyboard", async ({ page }) => {
  await openList(page);
  const filter = page.getByLabel("Status");
  await filter.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page).toHaveURL(new RegExp(`${LIST_PATH}$`));

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/status=/);
});

test.describe("at phone width", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("shows cards instead of the table", async ({ page }) => {
    await openList(page);
    await expect(page.getByRole("table")).toBeHidden();
    for (const operator of E2E_OPERATORS) {
      await expect(page.getByRole("link", { name: operator.legalName })).toBeVisible();
    }
  });
});

test("New Operator opens its form in a pop-up, a fingertip tall (A3)", async ({ page }) => {
  await openList(page);
  const newOperator = page.getByRole("button", { name: "New Operator" });
  const box = await newOperator.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);
  await newOperator.click();
  const dialog = page.getByRole("dialog", { name: "New Operator" });
  await expect(dialog.getByRole("textbox", { name: /^Legal business name/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("search runs as you type, without pressing Enter (A2)", async ({ page }) => {
  await openList(page);
  await page.getByLabel("Search by name or email").pressSequentially("charlie");
  await expect(tableRows(page)).toHaveCount(1);
  await expect(page).toHaveURL(/q=charlie/);
});
