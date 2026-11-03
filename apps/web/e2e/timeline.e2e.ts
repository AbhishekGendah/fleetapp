import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import { addCarToBook, fillRental, morningInDays, type RentalParties } from "./rental-steps";

/**
 * The fleet timeline: one row per car, a booking in the coming weeks as a
 * bar that opens its rental, reached from the keyboard, on a phone.
 */
const RENTER = { name: "Tia Timeline", email: "tia.timeline@example.test" };
const CAR_REGO = "E2E901";
const IDLE_REGO = "E2E902";
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: CAR_REGO };
/** Booked from two days ahead, so it is never in the past wherever the test runs. */
const BOOKING_STARTS_IN_DAYS = 2;
const BOOKING_DAYS = 7;
/**
 * The timeline page's JavaScript, compressed: the Scheduler loads only on
 * this page (282 KB on 3 Nov 2026), plus about 10%.
 */
const TIMELINE_PAGE_BUDGET_KB = 310;

test.describe.serial("the fleet timeline", () => {
  test("sets up a Renter, a booked car and an idle car", async ({ page }) => {
    await page.goto("/renters/new", { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: /^Full name/ }).fill(RENTER.name);
    await page.getByRole("textbox", { name: /^Phone/ }).pressSequentially("0412000901");
    await page.getByRole("textbox", { name: /^Email/ }).fill(RENTER.email);
    await page.getByRole("button", { name: "Add Renter" }).click();
    await expect(page.getByRole("heading", { name: RENTER.name })).toBeVisible();
    await addCarToBook(page, CAR_REGO);
    await addCarToBook(page, IDLE_REGO);
    await fillRental(
      page,
      PARTIES,
      morningInDays(BOOKING_STARTS_IN_DAYS),
      morningInDays(BOOKING_STARTS_IN_DAYS + BOOKING_DAYS),
    );
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.getByRole("heading", { name: `${CAR_REGO} · ${RENTER.name}` })).toBeVisible();
  });

  test.describe("on a phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("shows each car's row and opens the booking from the keyboard", async ({ page }) => {
      await page.goto("/rentals", { waitUntil: "networkidle" });
      await page.getByRole("link", { name: "Timeline", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Timeline", exact: true })).toBeVisible();
      const bar = page.getByRole("link", { name: new RegExp(`^${RENTER.name}, `) });
      await expect(bar).toBeVisible();
      await expect(page.getByText(CAR_REGO, { exact: true })).toBeVisible();
      await expect(page.getByText(IDLE_REGO, { exact: true })).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await scriptKilobytes(page)).toBeLessThanOrEqual(TIMELINE_PAGE_BUDGET_KB);
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      await bar.focus();
      await expect(bar).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: `${CAR_REGO} · ${RENTER.name}` }),
      ).toBeVisible();
    });

    test("moves a week later and back, never before this week", async ({ page }) => {
      await page.goto("/rentals/timeline", { waitUntil: "networkidle" });
      await expect(page.getByRole("link", { name: "Earlier" })).toHaveCount(0);
      await page.getByRole("link", { name: "Later" }).click();
      await expect(page.getByRole("link", { name: "Earlier" })).toBeVisible();
      await page.getByRole("link", { name: "This week" }).click();
      await expect(page.getByRole("link", { name: "Earlier" })).toHaveCount(0);

      await page.goto("/rentals/timeline?from=2020-01-06", { waitUntil: "networkidle" });
      await expect(page.getByRole("link", { name: "Earlier" })).toHaveCount(0);
    });
  });
});
