import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { MINIMUM_TOUCH_TARGET_PX, PHONE_VIEWPORT } from "./e2e-settings";
import { openRentalPage, rentalOutAndCharged } from "./money-steps";
import { expectNoSidewaysScroll } from "./phone-checks";
import type { RentalParties } from "./rental-steps";
import { recordUnpaidCharge } from "./test-records";

/**
 * Overdue money and the rental's money at a glance
 * (docs/plans/look-slice-2-overdue.md): a rental owing a charge long past
 * its grace days shows first in Needs attention on a phone and a computer;
 * Settings → Payments sets the grace days; the navy strip says the next
 * rent; the Money tab adds up charged, paid and owing.
 */
const RENTER = { name: "Olive Overdue", email: "olive.overdue@example.test", phone: "0412009201" };
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: "E2E9201" };
/** Longer late than anything else the browser tests make, so it is always first. */
const DAYS_LATE = 400;
const OVERDUE_WORDS = `$120.00 overdue · ${DAYS_LATE} days late`;
/** The rental page's JavaScript, compressed: as in rental-page.e2e.ts. */
const RENTAL_PAGE_BUDGET_KB = 400;
const COMPUTER_VIEWPORT = { width: 1280, height: 900 } as const;
const EDGE_PX = 4;
const GRACE_BOX = /^Count as overdue after this many days/;

let rentalId = "";

function attentionRows(page: Page): Locator {
  return page
    .getByRole("region", { name: "Needs attention" })
    .getByRole("list", { name: "Most urgent" })
    .getByRole("listitem");
}

/** The address a row's link opens, with its query (`?tab=money`). */
function isAt(path: string): (url: URL) => boolean {
  return (url) => `${url.pathname}${url.search}` === path;
}

const moneyTabPath = () => `/rentals/${rentalId}?tab=money`;

async function expectFirstIsOverdue(row: Locator): Promise<void> {
  await expect(row).toContainText(RENTER.name);
  await expect(row).toContainText(OVERDUE_WORDS);
  await expect(row.getByText("Overdue", { exact: true })).toBeVisible();
}

test.describe.serial("overdue money", () => {
  test("sets up a rental out, owing a charge due long ago", async ({ page }) => {
    rentalId = await rentalOutAndCharged(page, RENTER, PARTIES);
    await recordUnpaidCharge(rentalId, { daysAgo: DAYS_LATE, amountCents: 120_00 });
  });

  test.describe("on the Operator's phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("Needs attention shows it first, and one tap opens its Money tab", async ({ page }) => {
      await page.goto("/", { waitUntil: "networkidle" });
      const first = attentionRows(page).first();
      await expectFirstIsOverdue(first);
      // Only the rent past its grace is overdue: this week's rent, charged yesterday, is not.
      await expect(first).not.toContainText("$470.00");
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      const box = (await first.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);
      await page.mouse.click(box.x + EDGE_PX, box.y + EDGE_PX * 2);
      await expect(page).toHaveURL(isAt(moneyTabPath()));
    });
  });

  test.describe("on a computer", () => {
    test.use({ viewport: COMPUTER_VIEWPORT });

    test("first on the dashboard and on the full list, filtered by kind, opened by keyboard", async ({
      page,
    }) => {
      await page.goto("/", { waitUntil: "networkidle" });
      await expectFirstIsOverdue(attentionRows(page).first());
      await expectAccessible(page);

      await page.goto("/attention", { waitUntil: "networkidle" });
      await page.getByLabel("Kind").selectOption({ label: "Overdue payments" });
      await expect(page).toHaveURL(/kind=overdue_payment/);
      const row = page
        .getByRole("table")
        .getByRole("row")
        .filter({ has: page.getByRole("cell") })
        .first();
      await expect(row).toContainText(RENTER.name);
      await expectAccessible(page);

      await row.getByRole("link", { name: `$120.00 overdue, ${RENTER.name}` }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(isAt(moneyTabPath()));
    });
  });

  test.describe("the setting and the rental, on the Operator's phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("Settings → Payments sets the grace days: digits only, two at most, by keyboard", async ({
      page,
    }) => {
      await page.goto("/settings/payments", { waitUntil: "networkidle" });
      const box = page.getByRole("textbox", { name: GRACE_BOX });
      await expect(box).toHaveValue("2");
      await expect(box).toHaveAttribute("aria-required", "true");
      await expect(page.getByText(/are required/).first()).toBeVisible();
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      await box.focus();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("4x5 6");
      await expect(box).toHaveValue("45");
      await page.keyboard.press("Tab");
      await expect(page.getByText("Enter a number of days from 0 to 30.")).toBeVisible();
      await expectAccessible(page);

      await box.focus();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("10");
      await page.keyboard.press("Enter");
      await expect(page.getByText("Saved.")).toBeVisible();
      await page.reload({ waitUntil: "networkidle" });
      await expect(box).toHaveValue("10");

      // Put back as it was: other browser tests count on the default.
      await box.fill("2");
      await page.keyboard.press("Enter");
      await expect(page.getByText("Saved.")).toBeVisible();
    });

    test("the strip says the next rent: a week's rent, a week after the handover", async ({
      page,
    }) => {
      await openRentalPage(page, rentalId, PARTIES);
      const strip = page.getByRole("region", { name: `${PARTIES.carRego} · ${RENTER.name}` });
      const nextRent = strip.getByRole("term").filter({ hasText: /^Next rent$/ });
      await expect(nextRent).toBeVisible();
      await expect(strip.getByText("$350.00", { exact: true })).toBeVisible();
      await expect(
        strip.getByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}$/),
      ).toBeVisible();
      expect(await scriptKilobytes(page)).toBeLessThanOrEqual(RENTAL_PAGE_BUDGET_KB);
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
    });

    test("the Money tab adds up charged, paid and owing, and a payment over it shows credit in teal", async ({
      page,
    }) => {
      await openRentalPage(page, rentalId, PARTIES, "money");
      // In the page's main part: the navy strip above it has an Owing of its own.
      const totalOf = (label: string) =>
        page
          .getByRole("main")
          .locator("dt", { hasText: new RegExp(`^${label}$`) })
          .locator("xpath=following-sibling::dd[1]");
      await expect(totalOf("Charged")).toHaveText("$470.00");
      await expect(totalOf("Paid")).toHaveText("$0.00");
      await expect(totalOf("Owing")).toHaveText("$470.00");
      await expect(totalOf("Owing").locator("span")).toHaveClass(/text-destructive/);
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      await page.getByRole("button", { name: "Record payment" }).focus();
      await page.keyboard.press("Enter");
      const payment = page.getByRole("dialog");
      await payment.getByRole("textbox", { name: /^Amount/ }).fill("");
      await payment.getByRole("textbox", { name: /^Amount/ }).pressSequentially("500");
      await payment.getByLabel(/^How/).selectOption("cash");
      await payment.getByRole("button", { name: "Record payment" }).click();
      await expect(payment).toBeHidden();

      await expect(totalOf("Paid")).toHaveText("$500.00");
      await expect(totalOf("Owing")).toHaveText("$30.00 in credit");
      await expect(totalOf("Owing").locator("span")).toHaveClass(/text-teal/);
      await expectAccessible(page);

      // Paid up, so it leaves Needs attention.
      await page.goto(`/attention?kind=overdue_payment`, { waitUntil: "networkidle" });
      await expect(page.getByText(RENTER.name)).toHaveCount(0);
    });
  });
});
