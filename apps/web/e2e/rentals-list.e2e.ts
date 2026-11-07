import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { bookedRental, openRentalPage, rentalOutAndCharged } from "./money-steps";
import { expectNoSidewaysScroll } from "./phone-checks";
import { rentalIdOnPage, type RentalParties } from "./rental-steps";

/**
 * The Rentals list in the 6 Nov 2026 look: status filters in plain words
 * with counts, one When column, what is owed (red when behind) from the
 * ledger, names and regos as their own links on a computer, and cards that
 * open the rental from one tap on a phone.
 */
const OWING = { name: "Owen Owing", email: "owen.owing@example.test", phone: "0412000951" };
const BOOKED = { name: "Bea Booked", email: "bea.booked@example.test", phone: "0412000952" };
const OWING_PARTIES: RentalParties = { renterName: OWING.name, carRego: "E2E951" };
const BOOKED_PARTIES: RentalParties = { renterName: BOOKED.name, carRego: "E2E952" };
const CREDIT = { name: "Cara Credit", email: "cara.credit@example.test", phone: "0412000953" };
const CREDIT_PARTIES: RentalParties = { renterName: CREDIT.name, carRego: "E2E953" };
const PAID_AHEAD_DOLLARS = "100";
const CREDIT_WORDS = "$100.00 in credit";
const STATUS_WORDS = ["All", "Out", "Booked", "To close", "Finished"];
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
/** The theme's navy (--color-primary, #0d3747). */
const NAVY = "rgb(13, 55, 71)";

async function searchList(page: Page, text: string, query = ""): Promise<void> {
  await page.goto(`/rentals${query}`, { waitUntil: "networkidle" });
  await page.getByRole("searchbox", { name: "Search by Renter or rego" }).fill(text);
  await page.keyboard.press("Enter");
  await page.waitForURL(/q=/);
  await page.waitForLoadState("networkidle");
}

function tableRow(page: Page, renterName: string) {
  return page.getByRole("row").filter({ hasText: renterName });
}

test.describe.serial("the Rentals list", () => {
  test("sets up a rental out with rent owing and a booking", async ({ page }) => {
    await rentalOutAndCharged(page, OWING, OWING_PARTIES);
    await bookedRental(page, BOOKED, BOOKED_PARTIES);

    // Paid before anything is charged: the Renter is in credit.
    const creditRentalId = await bookedRental(page, CREDIT, CREDIT_PARTIES);
    await openRentalPage(page, creditRentalId, CREDIT_PARTIES, "money");
    await page.getByRole("button", { name: "Record payment" }).click();
    const payment = page.getByRole("dialog");
    await payment.getByRole("textbox", { name: /^Amount/ }).fill("");
    await payment.getByRole("textbox", { name: /^Amount/ }).pressSequentially(PAID_AHEAD_DOLLARS);
    await payment.getByLabel(/^How/).selectOption("cash");
    await payment.getByRole("button", { name: "Record payment" }).click();
    await expect(payment).toBeHidden();
  });

  test.describe("on a computer", () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test("filters by status in plain words, each with its count", async ({ page }) => {
      await page.goto("/rentals", { waitUntil: "networkidle" });
      const filters = page.getByRole("navigation", { name: "Rentals by status" });
      for (const words of STATUS_WORDS) {
        await expect(
          filters.getByRole("link", { name: new RegExp(`^${words} \\d+$`) }),
        ).toBeVisible();
      }
      await expect(filters.getByRole("link", { name: /^Active/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Timeline", exact: true })).toHaveCount(0);

      await filters.getByRole("link", { name: /^Out / }).click();
      await expect(page).toHaveURL(/status=out/);
      await expect(filters.getByRole("link", { name: /^Out / })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(tableRow(page, OWING.name)).toBeVisible();
      await expect(tableRow(page, BOOKED.name)).toHaveCount(0);
      await expectAccessible(page);
    });

    test("an old status address opens its new filter", async ({ page }) => {
      await page.goto("/rentals?status=active", { waitUntil: "networkidle" });
      await expect(page).toHaveURL(/status=out/);
      await page.goto("/rentals?status=returned", { waitUntil: "networkidle" });
      await expect(page).toHaveURL(/status=to-close/);
    });

    test("shows what is owed in red, and nothing yet on a booking", async ({ page }) => {
      await searchList(page, OWING_PARTIES.carRego);
      const owing = tableRow(page, OWING.name).getByRole("cell").nth(4);
      await expect(owing).toHaveText(/^\$\d[\d,]*\.\d{2}$/);
      await expect(owing.locator("span")).toHaveClass(/text-destructive/);
      await expect(tableRow(page, OWING.name).getByText("Out", { exact: true })).toBeVisible();
      await expect(tableRow(page, OWING.name)).toContainText(/\/wk/);

      await searchList(page, BOOKED_PARTIES.carRego);
      const row = tableRow(page, BOOKED.name);
      await expect(row.getByRole("cell").nth(4)).toHaveText("–");
      await expect(row.getByRole("cell").nth(2)).toHaveText(/^Starts /);
      await expect(row.getByText("Booked", { exact: true })).toBeVisible();
    });

    test("shows credit in words and teal, never a minus sign", async ({ page }) => {
      await searchList(page, CREDIT_PARTIES.carRego);
      const owing = tableRow(page, CREDIT.name).getByRole("cell").nth(4);
      await expect(owing).toHaveText(CREDIT_WORDS);
      await expect(owing.locator("span")).toHaveClass(/text-teal/);
      await expect(owing.locator("span")).not.toHaveClass(/text-destructive/);
    });

    test("links are never underlined, and turn navy on hover", async ({ page }) => {
      await searchList(page, BOOKED_PARTIES.carRego);
      const name = tableRow(page, BOOKED.name).getByRole("link", {
        name: BOOKED.name,
        exact: true,
      });
      await name.hover();
      await expect(name).toHaveCSS("text-decoration-line", "none");
      await expect(name).toHaveCSS("color", NAVY);
    });

    test("the name and rego open their own records; the rest of the row the rental", async ({
      page,
    }) => {
      await searchList(page, BOOKED_PARTIES.carRego);
      await tableRow(page, BOOKED.name)
        .getByRole("link", { name: BOOKED.name, exact: true })
        .click();
      await expect(page.getByRole("heading", { name: BOOKED.name, exact: true })).toBeVisible();

      await searchList(page, BOOKED_PARTIES.carRego);
      await tableRow(page, BOOKED.name)
        .getByRole("link", { name: BOOKED_PARTIES.carRego, exact: true })
        .click();
      await expect(page.getByRole("heading", { name: BOOKED_PARTIES.carRego })).toBeVisible();

      await searchList(page, BOOKED_PARTIES.carRego);
      // The When words are the row's own link, named with the Renter.
      const rowLink = tableRow(page, BOOKED.name).getByRole("link", {
        name: new RegExp(`^${BOOKED.name}'s rental, Starts `),
      });
      await expect(rowLink).toBeVisible();
      // A click on the Rent cell lands on the row's link, stretched over the row (forced: the
      // cell itself is covered by that link, which is the point).
      await tableRow(page, BOOKED.name).getByRole("cell").nth(3).click({ force: true });
      await rentalIdOnPage(page, BOOKED_PARTIES);
    });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("each rental is a card, opened by one tap anywhere on it", async ({ page }) => {
      await searchList(page, OWING_PARTIES.carRego);
      const card = page.getByRole("listitem").filter({ hasText: OWING.name });
      await expect(card).toContainText(`${OWING_PARTIES.carRego} · Toyota Corolla`);
      await expect(card.getByText(/owing$/)).toHaveClass(/text-destructive/);
      await expect(card.getByRole("link", { name: OWING.name, exact: true })).toHaveCount(0);
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
      // A tap on the car's line lands on the rental's link, stretched over the whole card (forced:
      // that link covering the line is the point).
      await card.getByText(`${OWING_PARTIES.carRego} · Toyota Corolla`).click({ force: true });
      await rentalIdOnPage(page, OWING_PARTIES);
    });

    test("a card in credit says so in teal", async ({ page }) => {
      await searchList(page, CREDIT_PARTIES.carRego);
      const card = page.getByRole("listitem").filter({ hasText: CREDIT.name });
      await expect(card.getByText(CREDIT_WORDS)).toHaveClass(/text-teal/);
    });
  });
});
