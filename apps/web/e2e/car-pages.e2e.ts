import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectFilterCounts, openFilter } from "./list-steps";
import { rentalOutAndCharged } from "./money-steps";
import { expectNoSidewaysScroll } from "./phone-checks";
import { addCarToBook, type RentalParties } from "./rental-steps";
import { recordInWorkshop } from "./test-records";

/**
 * The Cars list and one car's page in the 7 Nov 2026 look: filters in plain
 * words with counts, the rego opening the car from anywhere on its row, the
 * Renter's name opening them, cards with one tap on a phone; the navy strip
 * and all nine tabs on a car's page; and the old addresses still working.
 */
const RENTER = { name: "Cora Carpage", email: "cora.carpage@example.test", phone: "0412000961" };
const OUT: RentalParties = { renterName: RENTER.name, carRego: "CPG961" };
const IDLE_REGO = "CPG962";
const WORKSHOP_REGO = "CPG963";
const FILTER_WORDS = ["All", "Out", "Available", "In the workshop", "Archived"];
const TAB_NAMES = [
  "Overview",
  "Rentals",
  "Rego & insurance",
  "Damage",
  "Costs",
  "Photos",
  "Documents",
  "Odometer",
  "Log",
];
/**
 * The page's JavaScript budget, compressed (rule 33), at phone width: 453 KB
 * measured on 7 Nov 2026 plus about 10%. The weight is the shared form
 * pieces: the strip's Record damage pop-up and the Overview's status form.
 */
const CAR_PAGE_BUDGET_KB = 500;
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
/** The theme's navy (--color-primary, #0d3747). */
const NAVY = "rgb(13, 55, 71)";

async function searchCars(page: Page, text: string): Promise<void> {
  await page.goto("/cars", { waitUntil: "networkidle" });
  const search = page.getByRole("searchbox", { name: "Search by rego, make or model" });
  await search.fill(text);
  // By keyboard, as the list's search is a form.
  await search.press("Enter");
  await page.waitForURL(/q=/);
  await page.waitForLoadState("networkidle");
}

function carRow(page: Page, rego: string) {
  return page.getByRole("row").filter({ hasText: rego });
}

function carTab(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Car sections" })
    .getByRole("link", { name, exact: true });
}

/** Opens the car's page from the list by its rego, and gives its address. */
async function openCar(page: Page, rego: string): Promise<string> {
  await searchCars(page, rego);
  await carRow(page, rego)
    .getByRole("link", { name: new RegExp(`^${rego}, `) })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${rego}`) })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe.serial("the Cars list and a car's page", () => {
  test("sets up a car out with a Renter, one sitting idle and one in the workshop", async ({
    page,
  }) => {
    await rentalOutAndCharged(page, RENTER, OUT);
    await addCarToBook(page, IDLE_REGO);
    await addCarToBook(page, WORKSHOP_REGO);
    await recordInWorkshop(WORKSHOP_REGO, "2099-01-01");
  });

  test.describe("on a computer", () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test("filters by status in plain words, each with its count", async ({ page }) => {
      await page.goto("/cars", { waitUntil: "networkidle" });
      await expectFilterCounts(page, "Cars by status", FILTER_WORDS);
      const filters = page.getByRole("navigation", { name: "Cars by status" });
      await expect(filters.getByRole("link", { name: /^Rented/ })).toHaveCount(0);

      await openFilter(page, "Cars by status", "Out", /status=out/);
      await expect(carRow(page, OUT.carRego)).toBeVisible();
      await expect(carRow(page, IDLE_REGO)).toHaveCount(0);
      await expectAccessible(page);

      await openFilter(page, "Cars by status", "In the workshop", /status=workshop/);
      await expect(carRow(page, WORKSHOP_REGO)).toContainText("New clutch, back");
      await expect(carRow(page, WORKSHOP_REGO).getByText("In service")).toBeVisible();
    });

    test("an old status address opens its new filter", async ({ page }) => {
      await page.goto("/cars?status=rented", { waitUntil: "networkidle" });
      await expect(page).toHaveURL(/status=out/);
      await page.goto("/cars?status=in_service", { waitUntil: "networkidle" });
      await expect(page).toHaveURL(/status=workshop/);
    });

    test("says who has a car and since when, and how long one has sat", async ({ page }) => {
      await searchCars(page, "CPG96");
      await expect(carRow(page, OUT.carRego)).toContainText(`${RENTER.name}, since`);
      await expect(carRow(page, OUT.carRego).getByText("Out", { exact: true })).toBeVisible();
      await expect(carRow(page, IDLE_REGO)).toContainText(/Idle \d+ days?/);
      await expect(carRow(page, IDLE_REGO).getByText("Available", { exact: true })).toBeVisible();
      await expect(carRow(page, IDLE_REGO)).toContainText("1,000 km");
    });

    test("links are never underlined, and turn navy on hover", async ({ page }) => {
      await searchCars(page, OUT.carRego);
      const name = carRow(page, OUT.carRego).getByRole("link", { name: RENTER.name, exact: true });
      await name.hover();
      await expect(name).toHaveCSS("text-decoration-line", "none");
      await expect(name).toHaveCSS("color", NAVY);
    });

    test("the Renter's name opens them; the rego and the rest of the row the car", async ({
      page,
    }) => {
      await searchCars(page, OUT.carRego);
      await carRow(page, OUT.carRego).getByRole("link", { name: RENTER.name, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: RENTER.name })).toBeVisible();

      await searchCars(page, OUT.carRego);
      // As on the Renters list: wait for the searched row itself before clicking on it.
      await expect(
        carRow(page, OUT.carRego).getByRole("link", { name: new RegExp(`^${OUT.carRego}, `) }),
      ).toBeVisible();
      // A click on the odometer lands on the rego's link, stretched over the row (forced: the
      // cell itself is covered by that link, which is the point).
      await carRow(page, OUT.carRego).getByRole("cell").last().click({ force: true });
      await expect(
        page.getByRole("heading", { level: 1, name: new RegExp(`^${OUT.carRego}`) }),
      ).toBeVisible();
    });

    test("a car's page opens with the navy strip: who has it, and its key facts", async ({
      page,
    }) => {
      await openCar(page, OUT.carRego);
      const strip = page.getByRole("region", { name: new RegExp(`^${OUT.carRego}`) });
      await expect(strip).toContainText("2024 Toyota Corolla");
      await expect(strip.getByText("Out", { exact: true })).toBeVisible();
      for (const fact of ["Odometer", "Rego", "Insurance", "Price"]) {
        await expect(strip.getByText(fact, { exact: true })).toBeVisible();
      }
      await expect(strip).toContainText("Direct debit");
      await expect(strip.getByRole("button", { name: "Record damage" })).toBeVisible();
      await expect(strip.getByRole("link", { name: "New rental for this car" })).toBeVisible();
      await expect(carTab(page, "Overview")).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("region", { name: "Now" })).toContainText(
        `Out with ${RENTER.name}`,
      );
      await expectAccessible(page);

      await strip.getByRole("link", { name: RENTER.name, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: RENTER.name })).toBeVisible();
    });

    test("keeps all nine tabs, each opening by keyboard and passing the accessibility check", async ({
      page,
    }) => {
      const path = await openCar(page, OUT.carRego);
      for (const name of TAB_NAMES) {
        const tab = carTab(page, name);
        await tab.focus();
        await page.keyboard.press("Enter");
        await expect(carTab(page, name)).toHaveAttribute("aria-current", "page");
        await page.waitForLoadState("networkidle");
        await expectAccessible(page);
      }
      // The Rentals tab is the Rentals list's table: the When opens the rental.
      await page.goto(`${path}?tab=rentals`, { waitUntil: "networkidle" });
      await expect(
        page.getByRole("link", { name: new RegExp(`^${RENTER.name}'s rental, `) }),
      ).toBeVisible();
    });

    test("an old Details tab address opens the Overview", async ({ page }) => {
      const path = await openCar(page, IDLE_REGO);
      await page.goto(`${path}?tab=details`, { waitUntil: "networkidle" });
      await expect(carTab(page, "Overview")).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("region", { name: "Details" })).toContainText("Toyota");
      await expect(page.getByRole("button", { name: "Archive this car" })).toBeVisible();
    });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("each car is a card, opened by one tap anywhere on it", async ({ page }) => {
      await searchCars(page, OUT.carRego);
      const card = page.getByRole("listitem").filter({ hasText: OUT.carRego });
      await expect(card).toContainText(`With ${RENTER.name}, since`);
      await expect(card.getByRole("link", { name: RENTER.name, exact: true })).toHaveCount(0);
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
      await card.getByText("Toyota Corolla", { exact: true }).click({ force: true });
      await expect(
        page.getByRole("heading", { level: 1, name: new RegExp(`^${OUT.carRego}`) }),
      ).toBeVisible();
    });

    test("a car's page fits the screen, its tabs as tiles", async ({ page }) => {
      await openCarOnPhone(page, IDLE_REGO);
      await page.waitForLoadState("networkidle");
      expect(await scriptKilobytes(page)).toBeLessThanOrEqual(CAR_PAGE_BUDGET_KB);
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
      await carTab(page, "Damage").click();
      await expect(carTab(page, "Damage")).toHaveAttribute("aria-current", "page");
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
    });
  });
});

/** On a phone the card is the link: one tap on it opens the car. */
async function openCarOnPhone(page: Page, rego: string): Promise<void> {
  await searchCars(page, rego);
  await page.getByRole("link", { name: new RegExp(`^${rego}, `) }).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${rego}`) })).toBeVisible();
}
