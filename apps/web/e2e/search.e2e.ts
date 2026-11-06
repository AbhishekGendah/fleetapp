import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { MINIMUM_TOUCH_TARGET_PX, PHONE_VIEWPORT } from "./e2e-settings";
import { bookedRental } from "./money-steps";
import { expectNoSidewaysScroll } from "./phone-checks";
import type { RentalParties } from "./rental-steps";

/**
 * The top bar's search as you type (docs/plans/look-and-feel.md, "Slice 2"):
 * Cars, Renters and Rentals grouped in a drop-down, each a link to its page,
 * by keyboard as well as pointer, and on a phone from a search button.
 */
const RENTER = {
  name: "Sasha Searchwell",
  email: "sasha.searchwell@example.test",
  phone: "0412000961",
};
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: "E2E961" };
const RENTAL_TITLE = `${RENTER.name} · ${PARTIES.carRego}`;
/** More presses than there are links before the search box on any page. */
const MAXIMUM_TABS_TO_BOX = 20;

function searchBox(page: Page): Locator {
  return page.getByRole("combobox", { name: "Search", exact: true });
}

/** The booked car, under Cars in the results. */
function carResultOf(page: Page): Locator {
  return page.getByRole("group", { name: "Cars" }).getByRole("option", { name: /Toyota Corolla/ });
}

/** Types into the box the way a person does, so the search's code loads on the way. */
async function typeSearch(page: Page, text: string): Promise<void> {
  await searchBox(page).focus();
  await page.keyboard.type(text);
}

test.describe.serial("the top bar's search", () => {
  test("sets up a Renter, a car and a booking to find", async ({ page }) => {
    await bookedRental(page, RENTER, PARTIES);
  });

  test("shows results grouped as Cars, Renters and Rentals as you type", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const box = searchBox(page);
    await expect(box).toHaveAttribute("placeholder", "Search cars, Renters, rentals");

    await typeSearch(page, "S");
    // One letter searches nothing.
    await expect(page.getByRole("listbox")).toBeHidden();

    await page.keyboard.type("earchwell");
    const results = page.getByRole("listbox");
    await expect(results.getByRole("group", { name: "Renters" })).toBeVisible();
    await expect(
      results
        .getByRole("group", { name: "Renters" })
        .getByRole("option", { name: /Sasha Searchwell/ }),
    ).toBeVisible();
    await expect(
      results.getByRole("group", { name: "Rentals" }).getByRole("option", { name: /Booked/ }),
    ).toContainText(RENTAL_TITLE);
    await expect(results.getByRole("group", { name: "Cars" })).toHaveCount(0);
    await expectAccessible(page);

    await box.fill("e2e 961");
    await expect(
      results.getByRole("group", { name: "Cars" }).getByRole("option", { name: /Toyota Corolla/ }),
    ).toContainText(PARTIES.carRego);
    await expect(results.getByRole("group", { name: "Rentals" })).toContainText(RENTAL_TITLE);

    await box.fill("zzqx");
    await expect(page.getByText("No matches for “zzqx”")).toBeVisible();
  });

  test("works from the keyboard alone: Tab, type, arrow, Enter", async ({ page }) => {
    await page.goto("/cars", { waitUntil: "networkidle" });
    const box = searchBox(page);
    for (let presses = 0; presses < MAXIMUM_TABS_TO_BOX; presses += 1) {
      await page.keyboard.press("Tab");
      const focusedName = await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-label"),
      );
      if (focusedName === "Search") {
        break;
      }
    }
    await expect(box).toBeFocused();

    await page.keyboard.type(PARTIES.carRego);
    const carResult = carResultOf(page);
    await expect(carResult).toBeVisible();
    // Cars come first, so the first result is the car.
    await page.keyboard.press("ArrowDown");
    await expect(carResult).toHaveAttribute("data-highlighted", "");
    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("heading", { name: new RegExp(`^${PARTIES.carRego}`), level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/cars\/[0-9a-f-]+$/);
    await expect(page.getByRole("listbox")).toBeHidden();
  });

  test("never opens a result of older text while the newer text is searched", async ({ page }) => {
    await page.goto("/cars", { waitUntil: "networkidle" });
    const olderText = PARTIES.carRego.slice(0, -1);
    await typeSearch(page, olderText);
    const carResult = carResultOf(page);
    await expect(carResult).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(carResult).toHaveAttribute("data-highlighted", "");

    // The next search is held until let go, as on a slow connection.
    let letGo: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    await page.route("**/*", async (route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
        await held;
      }
      await route.fallback();
    });

    await page.keyboard.type(PARTIES.carRego.slice(-1));
    // Still in view, so the list does not flicker, but marked as not for this text.
    await expect(carResult).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await carResult.click({ force: true });
    // Opening a result empties the box at once, so a kept box means none was opened.
    await expect(searchBox(page)).toHaveValue(PARTIES.carRego);

    letGo();
    await expect(carResult).not.toHaveAttribute("aria-disabled", "true");
    await expect(page).toHaveURL(/\/cars$/);
    await page.unrouteAll({ behavior: "wait" });
  });

  test("Escape closes the results and keeps the focus in the box", async ({ page }) => {
    await page.goto("/rentals", { waitUntil: "networkidle" });
    await typeSearch(page, "Searchwell");
    await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible();

    await expect(searchBox(page)).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(searchBox(page)).toBeFocused();
    await expect(searchBox(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("a click on a rental opens the rental's page", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await typeSearch(page, "Searchwell");
    await page.getByRole("group", { name: "Rentals" }).getByRole("option").first().click();
    await expect(
      page.getByRole("heading", { name: `${PARTIES.carRego} · ${RENTER.name}` }),
    ).toBeVisible();
    await expect(searchBox(page)).toHaveValue("");
  });

  test.describe("on a phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("the search button opens the search across the top, box focused", async ({ page }) => {
      await page.goto("/", { waitUntil: "networkidle" });
      const button = page.getByRole("button", { name: "Search", exact: true });
      const box = await button.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);

      await button.click();
      const sheet = page.getByRole("dialog", { name: "Search" });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("combobox", { name: "Search", exact: true })).toBeFocused();
      await page.keyboard.type("Searchwell");
      await expect(sheet.getByRole("group", { name: "Renters" })).toBeVisible();
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(button).toBeFocused();
    });

    test("one tap on a Renter opens their page and closes the search", async ({ page }) => {
      await page.goto("/", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Search", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Search" });
      await expect(sheet.getByRole("combobox", { name: "Search", exact: true })).toBeFocused();
      await page.keyboard.type("Searchwell");
      const renter = sheet.getByRole("group", { name: "Renters" }).getByRole("option").first();
      expect((await renter.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
        MINIMUM_TOUCH_TARGET_PX,
      );
      await renter.click();

      await expect(page.getByRole("heading", { name: RENTER.name, exact: true })).toBeVisible();
      await expect(sheet).toBeHidden();
      // The Renter's page took the sheet's place in the history: one Back returns to Home.
      await page.goBack();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Good /);
    });
  });
});
