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
 * The Calendar page: Month on a computer (handovers and returns on a
 * Monday-first grid, a day's number opening that day), Day by day on a
 * phone (the week's strip, then a card per day), and By car (was the fleet
 * timeline: a row per car, bars opening rentals, workshop time amber).
 * Its views, days and car are in the page address; the old timeline
 * address lands on By car.
 */
const BOOKED = { name: "Tia Timeline", email: "tia.timeline@example.test", phone: "0412000901" };
const RETURNED = { name: "Rex Returned", email: "rex.returned@example.test", phone: "0412000902" };
const BOOKED_REGO = "E2E901";
const IDLE_REGO = "E2E902";
const RETURNED_REGO = "E2E903";
const BOOKED_PARTIES: RentalParties = { renterName: BOOKED.name, carRego: BOOKED_REGO };
const RETURNED_PARTIES: RentalParties = { renterName: RETURNED.name, carRego: RETURNED_REGO };
/** Booked from two days ahead, so it is never in the past and is in the dashboard's week. */
const BOOKING_STARTS_IN_DAYS = 2;
const BOOKING_DAYS = 7;
const WORKSHOP_DAYS = 5;
const CALENDAR_PATH = "/rentals/calendar";
const BY_CAR_PATH = `${CALENDAR_PATH}?view=car`;
/**
 * The By car view's JavaScript, compressed: the Scheduler and the choices,
 * loaded only there, plus the month grid's (the same page). The timeline
 * alone was 374 KB on 3 Nov 2026; with the month grid on the same page
 * since 6 Nov, measured and then plus about 10%.
 */
const BY_CAR_PAGE_BUDGET_KB = 470;
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

function isoDayIn(days: number): string {
  const moment = morningInDays(days);
  return `${moment.year}-${moment.month}-${moment.day}`;
}

const HANDOVER_DAY = isoDayIn(BOOKING_STARTS_IN_DAYS);

function carLink(page: Page, rego: string) {
  return page.locator(".fleet-timeline").getByRole("link", { name: rego, exact: true });
}

/** Shows one car only, by typing its rego in the car filter. */
async function chooseCar(page: Page, rego: string): Promise<void> {
  await page.getByRole("combobox", { name: "Car" }).fill(rego);
  await page.getByRole("option", { name: new RegExp(`^${rego}`) }).click();
  await page.waitForURL(/[?&]car=/);
  await page.waitForLoadState("networkidle");
}

test.describe.serial("the calendar", () => {
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

    test("opens Day by day on this week, today marked, fitting the screen", async ({ page }) => {
      await page.goto(CALENDAR_PATH, { waitUntil: "networkidle" });
      const views = page.getByRole("navigation", { name: "How to show the calendar" });
      await expect(views.getByRole("link", { name: "Day by day" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      const strip = page.getByRole("navigation", { name: "Days this week" });
      await expect(strip.getByRole("link")).toHaveCount(7);
      await expect(strip.locator('[aria-current="date"]')).toHaveCount(1);
      await expect(page.getByText(/^Today, /)).toBeVisible();
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
    });

    test("a day in the strip shows its card; a tap on a row opens the rental", async ({ page }) => {
      await page.goto(`${CALENDAR_PATH}?day=${HANDOVER_DAY}`, { waitUntil: "networkidle" });
      const strip = page.getByRole("navigation", { name: "Days this week" });
      const handoverDay = strip.locator(`a[href*="day=${HANDOVER_DAY}"]`);
      await expect(handoverDay).toContainText("has handovers or returns");
      await handoverDay.click();
      await expect(page).toHaveURL(new RegExp(`day=${HANDOVER_DAY}#day-${HANDOVER_DAY}`));
      const row = page
        .getByRole("listitem")
        .filter({ hasText: BOOKED.name })
        .filter({ hasText: "Handover" });
      await expect(row).toContainText(`${BOOKED_REGO} · Toyota Corolla`);
      // One tap per row on a phone: the name is plain words, the row the rental's link.
      await expect(row.getByRole("link", { name: BOOKED.name, exact: true })).toBeHidden();
      await row.click();
      await rentalIdOnPage(page, BOOKED_PARTIES);
    });

    test("previous and next move a week at a time", async ({ page }) => {
      await page.goto(`${CALENDAR_PATH}?day=${HANDOVER_DAY}`, { waitUntil: "networkidle" });
      await page.getByRole("link", { name: "Next week" }).click();
      await expect(page).toHaveURL(/day=\d{4}-\d{2}-\d{2}/);
      await expect(
        page.getByRole("navigation", { name: "Days this week" }).getByRole("link"),
      ).toHaveCount(7);
      await page.getByRole("link", { name: "Previous week" }).click();
      await expect(
        page
          .getByRole("navigation", { name: "Days this week" })
          .locator(`a[href*="${HANDOVER_DAY}"]`),
      ).toBeVisible();
    });

    test("By car shows the past and the future, swiping inside its box", async ({ page }) => {
      await page.goto(CALENDAR_PATH, { waitUntil: "networkidle" });
      await page
        .getByRole("navigation", { name: "How to show the calendar" })
        .getByRole("link", { name: "By car" })
        .click();
      await expect(page).toHaveURL(/view=car/);
      await expect(page.getByRole("link", { name: new RegExp(`^${BOOKED.name}, `) })).toBeVisible();
      await expect(
        page.getByRole("link", { name: new RegExp(`^${RETURNED.name}, `) }),
      ).toBeAttached();
      // Read out as the bar's own words (review A10-12).
      await expect(page.getByText(/^In service: New clutch, expected back/).first()).toBeAttached();
      await expect(page.getByRole("list", { name: "What the colours mean" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await scriptKilobytes(page)).toBeLessThanOrEqual(BY_CAR_PAGE_BUDGET_KB);
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      const bar = page.getByRole("link", { name: new RegExp(`^${BOOKED.name}, `) });
      await bar.focus();
      await page.keyboard.press("Enter");
      await rentalIdOnPage(page, BOOKED_PARTIES);
    });

    test("By car: a rego opens its car; the cars shown and the zoom stay in the address", async ({
      page,
    }) => {
      await page.goto(BY_CAR_PATH, { waitUntil: "networkidle" });
      const show = page.getByRole("group", { name: "Show cars" });
      await show.getByRole("button", { name: "Workshop" }).click();
      await expect(carLink(page, IDLE_REGO)).toBeVisible();
      await expect(carLink(page, BOOKED_REGO)).toHaveCount(0);
      await page
        .getByRole("group", { name: "Zoom" })
        .getByRole("button", { name: "Months" })
        .click();
      await expect(page).toHaveURL(/zoom=months/);
      await page.reload({ waitUntil: "networkidle" });
      await expect(carLink(page, BOOKED_REGO)).toHaveCount(0);
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      await carLink(page, IDLE_REGO).click();
      await expect(page.getByRole("heading", { name: IDLE_REGO })).toBeVisible();
    });
  });

  test.describe("on a touch screen", () => {
    test.use({ viewport: PHONE_VIEWPORT, hasTouch: true, isMobile: true });

    test("By car: a tap on an empty day starts a rental for that car", async ({ page }) => {
      // Only this car: its row is first, whatever other tests' cars are there.
      await page.goto(BY_CAR_PATH, { waitUntil: "networkidle" });
      await chooseCar(page, IDLE_REGO);
      const header = page.locator(".fleet-timeline-row").filter({ hasText: IDLE_REGO });
      await header.scrollIntoViewIfNeeded();
      const name = (await header.boundingBox())!;
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

    test("Month: handovers on their day open the rental; today is circled", async ({ page }) => {
      await page.goto(`${CALENDAR_PATH}?month=${HANDOVER_DAY.slice(0, 7)}`, {
        waitUntil: "networkidle",
      });
      await expect(page.getByRole("link", { name: "Previous month" })).toBeVisible();
      const label = page.getByRole("link", {
        name: `9:00 am Handover · Tia · ${BOOKED_REGO}`,
      });
      await expect(label).toBeVisible();
      await expect(
        page.locator('.bookings-calendar [role="cell"][aria-current="date"]'),
      ).toHaveCount(HANDOVER_DAY.slice(0, 7) === isoDayIn(0).slice(0, 7) ? 1 : 0);
      await expectAccessible(page);
      await label.click();
      await rentalIdOnPage(page, BOOKED_PARTIES);
    });

    test("Month: a day's number opens that day, listing its handovers and returns", async ({
      page,
    }) => {
      await page.goto(`${CALENDAR_PATH}?month=${HANDOVER_DAY.slice(0, 7)}`, {
        waitUntil: "networkidle",
      });
      const dayNumber = page
        .locator(`.bookings-calendar [data-date="${HANDOVER_DAY}"]`)
        .getByRole("link", { name: /^Open / });
      await expect(dayNumber).toHaveText(String(Number(HANDOVER_DAY.slice(-2))));
      // By keyboard, as FullCalendar's day links are not plain links.
      await dayNumber.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`day=${HANDOVER_DAY}$`));
      const row = page.getByRole("listitem").filter({ hasText: BOOKED.name });
      // On a computer the name and rego are links of their own; the time opens the rental.
      await expect(row.getByRole("link", { name: BOOKED.name, exact: true })).toBeVisible();
      await expect(row.getByRole("link", { name: BOOKED_REGO, exact: true })).toBeVisible();
      await expect(page.locator(".bookings-calendar-chosen-day")).toHaveAttribute(
        "data-date",
        HANDOVER_DAY,
      );
      await expectAccessible(page);
      await row.getByRole("link", { name: `Handover to ${BOOKED.name}, 9:00 am` }).click();
      await rentalIdOnPage(page, BOOKED_PARTIES);
    });

    test("the dashboard's later-this-week date opens the calendar on that day", async ({
      page,
    }) => {
      await page.goto("/", { waitUntil: "networkidle" });
      await page.locator(`a[href="${CALENDAR_PATH}?day=${HANDOVER_DAY}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`\\?day=${HANDOVER_DAY}$`));
      await expect(
        page.getByRole("listitem").filter({ hasText: BOOKED.name }).filter({ hasText: "Handover" }),
      ).toBeVisible();
    });

    test("the view switch works from the keyboard, and each view has its address", async ({
      page,
    }) => {
      await page.goto(CALENDAR_PATH, { waitUntil: "networkidle" });
      const views = page.getByRole("navigation", { name: "How to show the calendar" });
      await expect(views.getByRole("link", { name: "Month" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await views.getByRole("link", { name: "By car" }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/view=car/);
      await expect(views.getByRole("link", { name: "By car" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.getByRole("link", { name: "Next two weeks" })).toBeVisible();
      await expectAccessible(page);
      await views.getByRole("link", { name: "Month" }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/rentals\/calendar$/);
    });

    test("the old timeline address opens By car, on its day and zoom", async ({ page }) => {
      const day = isoDayIn(-30);
      await page.goto(`/rentals/timeline?on=${day}&zoom=weeks`, { waitUntil: "networkidle" });
      await expect(page).toHaveURL(
        new RegExp(`/rentals/calendar\\?view=car&day=${day}&zoom=weeks`),
      );
      await expect(carLink(page, BOOKED_REGO)).toBeVisible();
    });

    test("By car fills the screen, and an empty day starts a rental for that car", async ({
      page,
    }) => {
      // Only this car: its row is first, whatever other tests' cars are there.
      await page.goto(BY_CAR_PATH, { waitUntil: "networkidle" });
      await chooseCar(page, IDLE_REGO);
      const header = page.locator(".fleet-timeline-row").filter({ hasText: IDLE_REGO });
      await header.scrollIntoViewIfNeeded();
      const box = page.locator(".fleet-timeline");
      const nameBox = (await header.boundingBox())!;
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
