import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import {
  addCarToBook,
  addRenter,
  fillRental,
  morningInDays,
  rentalIdOnPage,
  type RentalParties,
} from "./rental-steps";
import {
  recordHandover,
  recordInWorkshop,
  recordReturn,
  recordSignedContract,
} from "./test-records";

/**
 * The fleet timeline: one row per car over months, a booking ahead and a
 * rental already back as bars that open them, workshop time striped; cars
 * chosen by search, status and name; zoom; a car's name opening its quick
 * view; an empty day starting a rental. On a phone and a computer.
 */
const BOOKED = { name: "Tia Timeline", email: "tia.timeline@example.test", phone: "0412000901" };
const RETURNED = { name: "Rex Returned", email: "rex.returned@example.test", phone: "0412000902" };
const BOOKED_REGO = "E2E901";
const IDLE_REGO = "E2E902";
const RETURNED_REGO = "E2E903";
const BOOKED_PARTIES: RentalParties = { renterName: BOOKED.name, carRego: BOOKED_REGO };
const RETURNED_PARTIES: RentalParties = { renterName: RETURNED.name, carRego: RETURNED_REGO };
/** Booked from two days ahead, so it is never in the past wherever the test runs. */
const BOOKING_STARTS_IN_DAYS = 2;
const BOOKING_DAYS = 7;
const WORKSHOP_DAYS = 5;
const TIMELINE_PATH = "/rentals/timeline";
/**
 * The timeline page's JavaScript, compressed: the Scheduler, the filters
 * (the car picker and the page-address keeper) and the quick-view panel,
 * all loaded only on this page. 374 KB on 3 Nov 2026 (v1 was 282, without
 * them), plus about 10%.
 */
const TIMELINE_PAGE_BUDGET_KB = 410;
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

async function book(page: Page, parties: RentalParties): Promise<string> {
  await fillRental(
    page,
    parties,
    morningInDays(BOOKING_STARTS_IN_DAYS),
    morningInDays(BOOKING_STARTS_IN_DAYS + BOOKING_DAYS),
  );
  await page.getByRole("button", { name: "Book", exact: true }).click();
  // Booking opens the rental's page; other tests' rentals may push it off the list's first page.
  return rentalIdOnPage(page, parties);
}

async function openTimeline(page: Page, query = ""): Promise<void> {
  await page.goto(`${TIMELINE_PATH}${query}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: BOOKED_REGO, exact: true })).toBeVisible();
}

function carRow(page: Page, rego: string) {
  return page.getByRole("button", { name: rego, exact: true });
}

function isoDayIn(days: number): string {
  const moment = morningInDays(days);
  return `${moment.year}-${moment.month}-${moment.day}`;
}

test.describe.serial("the fleet timeline", () => {
  test("sets up a booking ahead, a rental already back and a car in the workshop", async ({
    page,
  }) => {
    await addRenter(page, BOOKED);
    await addRenter(page, RETURNED);
    for (const rego of [BOOKED_REGO, IDLE_REGO, RETURNED_REGO]) {
      await addCarToBook(page, rego);
    }
    await book(page, BOOKED_PARTIES);
    const returnedId = await book(page, RETURNED_PARTIES);
    await recordSignedContract(returnedId);
    await recordHandover(returnedId);
    await recordReturn(returnedId);
    await recordInWorkshop(IDLE_REGO, isoDayIn(WORKSHOP_DAYS));
  });

  test.describe("on a phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("shows the past and the future, swiping inside its box", async ({ page }) => {
      await page.goto("/rentals", { waitUntil: "networkidle" });
      await page.getByRole("link", { name: "Timeline", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Timeline", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(`^${BOOKED.name}, `) })).toBeVisible();
      await expect(
        page.getByRole("link", { name: new RegExp(`^${RETURNED.name}, `) }),
      ).toBeAttached();
      await expect(page.getByLabel(/^In service: New clutch, expected back/)).toBeAttached();
      await expect(page.getByRole("list", { name: "What the colours mean" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await scriptKilobytes(page)).toBeLessThanOrEqual(TIMELINE_PAGE_BUDGET_KB);
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      const bar = page.getByRole("link", { name: new RegExp(`^${BOOKED.name}, `) });
      await bar.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: `${BOOKED_REGO} · ${BOOKED.name}` }),
      ).toBeVisible();
    });

    test("a car's name opens its quick view, from a tap or the keyboard", async ({ page }) => {
      await openTimeline(page);
      await carRow(page, BOOKED_REGO).click();
      const panel = page.getByRole("dialog", { name: new RegExp(`^${BOOKED_REGO}`) });
      await expect(panel).toBeVisible();
      await expect(panel.getByText("Toyota Corolla · 2024")).toBeVisible();
      await expect(panel.getByText(new RegExp(`^${BOOKED.name}, from `))).toBeVisible();
      await expectAccessible(page);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();

      await carRow(page, IDLE_REGO).focus();
      await page.keyboard.press("Enter");
      const idlePanel = page.getByRole("dialog", { name: new RegExp(`^${IDLE_REGO}`) });
      await expect(idlePanel.getByText(/^In service: New clutch, expected back/)).toBeVisible();
      await idlePanel.getByRole("link", { name: "New rental for this car" }).click();
      await expect(page).toHaveURL(/\/rentals\/new\?vehicleId=/);
    });

    test("chooses the cars by search, status and name, and keeps the choice", async ({ page }) => {
      await openTimeline(page);
      await page.getByRole("searchbox", { name: "Search cars" }).fill(IDLE_REGO);
      await expect(carRow(page, IDLE_REGO)).toBeVisible();
      await expect(carRow(page, BOOKED_REGO)).toHaveCount(0);
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByRole("searchbox", { name: "Search cars" })).toHaveValue(IDLE_REGO);
      await expect(carRow(page, IDLE_REGO)).toBeVisible();
      await page.getByRole("button", { name: "Clear" }).click();
      await expect(carRow(page, BOOKED_REGO)).toBeVisible();

      // On a phone the less used choices are folded away until asked for.
      await expect(page.getByRole("group", { name: "Show cars" })).toBeHidden();
      await page.getByText("More choices").click();
      const show = page.getByRole("group", { name: "Show cars" });
      await show.getByRole("button", { name: "Workshop" }).click();
      await expect(carRow(page, IDLE_REGO)).toBeVisible();
      await expect(carRow(page, BOOKED_REGO)).toHaveCount(0);
      await show.getByRole("button", { name: "Out" }).click();
      // None of these cars is out (other tests' cars may be).
      for (const rego of [BOOKED_REGO, IDLE_REGO, RETURNED_REGO]) {
        await expect(carRow(page, rego)).toHaveCount(0);
      }
      await show.getByRole("button", { name: "All" }).click();

      await page.getByRole("combobox", { name: "Only these cars" }).fill(RETURNED_REGO);
      await page.getByRole("option", { name: new RegExp(RETURNED_REGO) }).click();
      // Escape closes the list and keeps the choice.
      await page.keyboard.press("Escape");
      await expect(carRow(page, RETURNED_REGO)).toBeVisible();
      await expect(carRow(page, BOOKED_REGO)).toHaveCount(0);
      await expect(page.getByRole("button", { name: `Remove ${RETURNED_REGO}` })).toBeVisible();
      await expect(page.getByText("More choices (1 on)")).toBeVisible();
      await expectAccessible(page);
    });

    test("zooms out to months, and goes to a date months back", async ({ page }) => {
      await openTimeline(page);
      await page
        .getByRole("group", { name: "Zoom" })
        .getByRole("button", { name: "Months" })
        .click();
      await expect(page).toHaveURL(/zoom=months/);
      await expect(carRow(page, BOOKED_REGO)).toBeVisible();
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      await page.getByText("More choices").click();
      await page.getByLabel("Go to a date").fill(isoDayIn(-120));
      await page.getByRole("button", { name: "Go", exact: true }).click();
      await expect(page).toHaveURL(/on=\d{4}-\d{2}-\d{2}/);
      await expect(carRow(page, BOOKED_REGO)).toBeVisible();
      await expect(
        page.getByRole("link", { name: new RegExp(`^${BOOKED.name}, `) }),
      ).toBeAttached();
    });
  });

  test.describe("on a touch screen", () => {
    test.use({ viewport: PHONE_VIEWPORT, hasTouch: true, isMobile: true });

    test("a tap on an empty day starts a rental for that car", async ({ page }) => {
      // Only this car: its row is first, whatever other tests' cars are there.
      await page.goto(`${TIMELINE_PATH}?q=${IDLE_REGO}`, { waitUntil: "networkidle" });
      await carRow(page, IDLE_REGO).scrollIntoViewIfNeeded();
      const name = (await carRow(page, IDLE_REGO).boundingBox())!;
      const firstDay = (await page.locator(".fleet-timeline").boundingBox())!;
      // Days are 44px wide on a phone; today is first. A day after the workshop block, on screen.
      const dayWidth = 44;
      const daysOnScreen = Math.floor(
        (firstDay.x + firstDay.width - name.x - name.width) / dayWidth,
      );
      await page.locator(".fleet-timeline").evaluate(
        (box, scrollBy) => {
          box.querySelector(".scheduler_default_scrollable")?.scrollBy({ left: scrollBy });
        },
        dayWidth * (WORKSHOP_DAYS + 2 - daysOnScreen + 1),
      );
      await page.touchscreen.tap(
        name.x + name.width + dayWidth * (daysOnScreen - 0.5),
        name.y + name.height / 2,
      );
      await expect(page).toHaveURL(/\/rentals\/new\?vehicleId=[^&]+&startsOn=\d{4}-\d{2}-\d{2}/);
    });
  });

  test.describe("on a computer", () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test("fills the screen, and an empty day starts a rental for that car", async ({ page }) => {
      // Only this car: its row is first, whatever other tests' cars are there.
      await page.goto(`${TIMELINE_PATH}?q=${IDLE_REGO}`, { waitUntil: "networkidle" });
      await carRow(page, IDLE_REGO).scrollIntoViewIfNeeded();
      const box = page.locator(".fleet-timeline");
      const name = carRow(page, IDLE_REGO);
      const nameBox = (await name.boundingBox())!;
      const timelineBox = (await box.boundingBox())!;
      expect(timelineBox.width).toBeGreaterThan(DESKTOP_VIEWPORT.width / 2);
      await expectAccessible(page);

      // Today is at the left: a day well after the workshop block, on the idle car's row.
      const dayWidth = (timelineBox.width - nameBox.width) / 14;
      await page.mouse.click(
        nameBox.x + nameBox.width + dayWidth * (WORKSHOP_DAYS + 3.5),
        nameBox.y + nameBox.height / 2,
      );
      await expect(page).toHaveURL(/\/rentals\/new\?vehicleId=[^&]+&startsOn=\d{4}-\d{2}-\d{2}/);
      await expect(page.getByRole("combobox", { name: /^Car/ })).toHaveValue(IDLE_REGO);
    });
  });
});
