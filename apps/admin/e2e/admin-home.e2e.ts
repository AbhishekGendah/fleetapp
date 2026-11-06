import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { E2E_OPERATORS, PHONE_VIEWPORT } from "./e2e-settings";

/** Abhi's admin suggestions (docs/plans/qol-suggestions.md): the home page and a business's tabs. */
const SUSPENDED_OPERATOR = E2E_OPERATORS.find((operator) => operator.isSuspended)!.legalName;
const ACTIVE_OPERATOR = E2E_OPERATORS.find((operator) => !operator.isSuspended)!.legalName;

/** A computer-width window, short enough that a business's page scrolls under the top bar. */
const DESKTOP_WIDTH_PX = 1280;
const SHORT_WINDOW_HEIGHT_PX = 420;
/** Far enough that the page's title has gone under the top bar, not past it. */
const PARTLY_SCROLLED_PX = 120;

test.use({ viewport: PHONE_VIEWPORT });

test("the logo goes to a home page whose counts open the list behind them (A1)", async ({
  page,
}) => {
  await page.goto("/operators", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Home" }).first().click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Businesses" })).toBeVisible();
  await expectAccessible(page);

  await page
    .getByRole("navigation", { name: "Businesses by status" })
    .getByRole("link", { name: /^Suspended/ })
    .click();
  await expect(page).toHaveURL(/\/operators\?status=suspended/);
  await expect(page.getByText(SUSPENDED_OPERATOR).first()).toBeVisible();
});

test("a business's page has Details, Invites and Log tabs, the Log a page at a time (A5-A7)", async ({
  page,
}) => {
  await page.goto("/operators", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: ACTIVE_OPERATOR }).first().click();
  const tabs = page.getByRole("navigation", { name: "This business" });
  await expect(tabs.getByRole("link", { name: "Details" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Setup and use" })).toBeVisible();
  await expectAccessible(page);

  await tabs.getByRole("link", { name: "Invites" }).click();
  await expect(page).toHaveURL(/\/invites$/);
  await expect(page.getByRole("heading", { name: "Invites" })).toBeVisible();

  await tabs.getByRole("link", { name: "Log" }).click();
  await expect(page).toHaveURL(/\/log$/);
  await expect(page.getByLabel("Search the log")).toBeVisible();
  await expectAccessible(page);

  // Scrolled, nothing draws over the top bar (the page title once did, 6 Nov 2026).
  // A wide, short window, as Abhi saw it, so the page scrolls a little under the bar.
  await page.setViewportSize({ width: DESKTOP_WIDTH_PX, height: SHORT_WINDOW_HEIGHT_PX });
  await page.evaluate((top) => window.scrollTo(0, top), PARTLY_SCROLLED_PX);
  const isTopBarOnTop = await page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) {
      return false;
    }
    const box = header.getBoundingClientRect();
    const spots = [0.1, 0.5, 0.9].flatMap((across) =>
      [0.15, 0.5, 0.85].map((down) => [box.left + box.width * across, box.top + box.height * down]),
    );
    return spots.every(([x = 0, y = 0]) => {
      const point = document.elementFromPoint(x, y);
      return point !== null && header.contains(point);
    });
  });
  expect(isTopBarOnTop).toBe(true);
});
