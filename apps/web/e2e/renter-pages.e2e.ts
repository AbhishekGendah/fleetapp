import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectFilterCounts, openFilter } from "./list-steps";
import { bookedRental, rentalOutAndCharged } from "./money-steps";
import { expectNoSidewaysScroll } from "./phone-checks";
import { addRenterReadyToRent, type RentalParties } from "./rental-steps";
import { recordUnpaidCharge } from "./test-records";

/**
 * The Renters list and one Renter's page in the 7 Nov 2026 look: filters in
 * plain words with counts, the phone but never the email, what is owing from
 * the ledger and Overdue, the name opening the Renter from anywhere on the
 * row and the rego the car, the navy strip and all seven tabs, the old
 * addresses, and the licence number never anywhere on the page.
 */
const RENTING = { name: "Rae Renting", email: "rae.renting@example.test", phone: "0412000971" };
const RENTING_CAR: RentalParties = { renterName: RENTING.name, carRego: "RNP971" };
const BOOKED = { name: "Bram Booked", email: "bram.booked@example.test", phone: "0412000972" };
const BOOKED_CAR: RentalParties = { renterName: BOOKED.name, carRego: "RNP972" };
const LICENSED = {
  name: "Lena Licensed",
  email: "lena.licensed@example.test",
  phone: "0412000973",
  licenceNumber: "7659973",
};
const FILTER_WORDS = ["All", "Renting now", "Booked", "To review", "Do not rent", "Archived"];
const TAB_NAMES = ["Overview", "Rentals", "Money", "Details", "Licence", "Notes", "Log"];
const DAYS_LATE = 9;
/**
 * The page's JavaScript budget, compressed (rule 33), at phone width: 404 KB
 * measured on 7 Nov 2026 plus about 10%. The weight is the shared form
 * pieces: the Overview's details form sender and its status and note forms.
 */
const RENTER_PAGE_BUDGET_KB = 445;
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };

async function searchRenters(page: Page, text: string): Promise<void> {
  await page.goto("/renters", { waitUntil: "networkidle" });
  const search = page.getByRole("searchbox", { name: "Search by name, phone or email" });
  await search.fill(text);
  await search.press("Enter");
  await page.waitForURL(/q=/);
  await page.waitForLoadState("networkidle");
}

function renterRow(page: Page, name: string) {
  return page.getByRole("row").filter({ hasText: name });
}

function renterTab(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Renter sections" })
    .getByRole("link", { name, exact: true });
}

function renterHeading(page: Page, name: string) {
  return page.getByRole("heading", { level: 1, name, exact: true });
}

/** Opens the Renter's page from the list by their name, and gives its address. */
async function openRenter(page: Page, name: string): Promise<string> {
  await searchRenters(page, name);
  await page.getByRole("link", { name, exact: true }).filter({ visible: true }).first().click();
  await expect(renterHeading(page, name)).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe.serial("the Renters list and a Renter's page", () => {
  test("sets up a Renter with a car out and money overdue, one booked, one with a licence", async ({
    page,
  }) => {
    const rentalId = await rentalOutAndCharged(page, RENTING, RENTING_CAR);
    await recordUnpaidCharge(rentalId, { daysAgo: DAYS_LATE, amountCents: 120_00 });
    await bookedRental(page, BOOKED, BOOKED_CAR);
    await addRenterReadyToRent(page, LICENSED);
  });

  test.describe("on a computer", () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test("filters by status in plain words, each with its count", async ({ page }) => {
      await page.goto("/renters", { waitUntil: "networkidle" });
      await expectFilterCounts(page, "Renters by status", FILTER_WORDS);
      await openFilter(page, "Renters by status", "Renting now", /status=renting/);
      await expect(renterRow(page, RENTING.name)).toBeVisible();
      await expect(renterRow(page, BOOKED.name)).toHaveCount(0);
      await expectAccessible(page);

      await openFilter(page, "Renters by status", "Booked", /status=booked/);
      await expect(renterRow(page, BOOKED.name)).toBeVisible();
      await expect(renterRow(page, RENTING.name)).toHaveCount(0);
    });

    test("an old status address opens its new filter", async ({ page }) => {
      await page.goto("/renters?status=waiting_review", { waitUntil: "networkidle" });
      await expect(page).toHaveURL(/status=to-review/);
      await page.goto("/renters?status=do_not_rent", { waitUntil: "networkidle" });
      await expect(page).toHaveURL(/status=do-not-rent/);
      // Active meant everyone not marked Do not rent: All now.
      await page.goto("/renters?status=active", { waitUntil: "networkidle" });
      await expect(page).not.toHaveURL(/status=/);
    });

    test("shows the phone but never the email, the car, and Overdue in red", async ({ page }) => {
      await searchRenters(page, RENTING.name);
      const row = renterRow(page, RENTING.name);
      await expect(row).toContainText("0412 000 971");
      await expect(page.getByRole("main")).not.toContainText(RENTING.email);
      await expect(row.getByRole("link", { name: RENTING_CAR.carRego, exact: true })).toBeVisible();
      await expect(row.getByText("Renting", { exact: true })).toBeVisible();
      await expect(row.getByText("Overdue", { exact: true })).toBeVisible();
      await expect(row.getByRole("cell").nth(3).locator("span")).toHaveClass(/text-destructive/);
    });

    test("the name and the rest of the row open the Renter; the rego the car", async ({ page }) => {
      await searchRenters(page, RENTING.name);
      await renterRow(page, RENTING.name)
        .getByRole("link", { name: RENTING_CAR.carRego, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { level: 1, name: new RegExp(`^${RENTING_CAR.carRego}`) }),
      ).toBeVisible();

      await searchRenters(page, RENTING.name);
      // The row must be the searched list's own before the click, or it can land on one that
      // is being replaced and go nowhere (seen once in CI).
      await expect(
        renterRow(page, RENTING.name).getByRole("link", { name: RENTING.name, exact: true }),
      ).toBeVisible();
      // A click on Since lands on the name's link, stretched over the row (forced: the cell is
      // covered by that link, which is the point).
      // Retried: in CI the list can still re-render from the search just after it settles,
      // and a click on the row being replaced goes nowhere. The row link must still open it.
      await expect(async () => {
        await renterRow(page, RENTING.name).getByRole("cell").last().click({ force: true });
        await expect(renterHeading(page, RENTING.name)).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 15_000 });
    });

    test("a Renter's page opens with the navy strip: owing, their car, licence and since", async ({
      page,
    }) => {
      await openRenter(page, RENTING.name);
      const strip = page.getByRole("region", { name: RENTING.name });
      await expect(strip).toContainText(`${DAYS_LATE} days late`);
      await expect(strip.getByText("Overdue", { exact: true })).toBeVisible();
      for (const fact of ["Owing", "Renting now", "Licence", "With you since"]) {
        await expect(strip.getByText(fact, { exact: true })).toBeVisible();
      }
      await expect(strip.getByRole("link", { name: "0412 000 971" })).toHaveAttribute(
        "href",
        "tel:0412000971",
      );
      await expect(renterTab(page, "Overview")).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("region", { name: "Money" })).toContainText("owing");
      await expectAccessible(page);

      await strip.getByRole("link", { name: RENTING_CAR.carRego, exact: true }).click();
      await expect(
        page.getByRole("heading", { level: 1, name: new RegExp(`^${RENTING_CAR.carRego}`) }),
      ).toBeVisible();
    });

    test("keeps all seven tabs, each opening by keyboard and passing the accessibility check", async ({
      page,
    }) => {
      await openRenter(page, RENTING.name);
      for (const name of TAB_NAMES) {
        await renterTab(page, name).focus();
        await page.keyboard.press("Enter");
        await expect(renterTab(page, name)).toHaveAttribute("aria-current", "page");
        await page.waitForLoadState("networkidle");
        await expectAccessible(page);
      }
    });

    test("never shows the licence number, on the list or any tab", async ({ page }) => {
      // What the page shows (its words on screen), as the Edit licence form, opened on purpose to
      // change it, is the one place the number is.
      const shown = { useInnerText: true };
      await searchRenters(page, LICENSED.name);
      await expect(page.locator("body")).not.toContainText(LICENSED.licenceNumber, shown);
      const path = await openRenter(page, LICENSED.name);
      for (const name of TAB_NAMES) {
        await page.goto(`${path}?tab=${name.toLowerCase()}`, { waitUntil: "networkidle" });
        await expect(renterTab(page, name)).toHaveAttribute("aria-current", "page");
        await expect(page.locator("body")).not.toContainText(LICENSED.licenceNumber, shown);
      }
      // The photos are only "on file", opened on purpose; never pictures on the page.
      await page.goto(`${path}?tab=licence`, { waitUntil: "networkidle" });
      await expect(page.getByText("Front: on file")).toBeVisible();
      await expect(page.getByRole("button", { name: "Open front" })).toBeVisible();
      await expect(page.getByRole("main").locator("img")).toHaveCount(0);
    });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("each Renter is a card, opened by one tap anywhere on it", async ({ page }) => {
      await searchRenters(page, RENTING.name);
      const card = page.getByRole("listitem").filter({ hasText: RENTING.name });
      await expect(card).toContainText(`${RENTING_CAR.carRego} · `);
      await expect(card.getByText(/owing$/)).toHaveClass(/text-destructive/);
      await expect(card.getByRole("link", { name: RENTING_CAR.carRego, exact: true })).toHaveCount(
        0,
      );
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
      await card.getByText(/^Since /).click({ force: true });
      await expect(renterHeading(page, RENTING.name)).toBeVisible();
    });

    test("a Renter's page fits the screen, its tabs as tiles", async ({ page }) => {
      await searchRenters(page, BOOKED.name);
      await page
        .getByRole("link", { name: BOOKED.name, exact: true })
        .filter({ visible: true })
        .click();
      await expect(renterHeading(page, BOOKED.name)).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await scriptKilobytes(page)).toBeLessThanOrEqual(RENTER_PAGE_BUDGET_KB);
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
      await renterTab(page, "Money").click();
      await expect(renterTab(page, "Money")).toHaveAttribute("aria-current", "page");
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
    });
  });
});
