import { expect, test, type Page } from "@playwright/test";

import { E2E_OPERATORS, PHONE_VIEWPORT } from "./e2e-settings";

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
  // TODO: today they are announced as plain cells; passes once the list is on
  // TanStack Table (library swap stage 7).
  test.fail();
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
