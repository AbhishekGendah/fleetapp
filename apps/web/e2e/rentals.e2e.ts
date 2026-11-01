import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test, type Page } from "@playwright/test";

import { MINIMUM_TOUCH_TARGET_PX, PHONE_VIEWPORT } from "./e2e-settings";
import { expectPdf } from "./pdf-checks";

/**
 * Bookings as an Operator makes them: a car booked for a Renter, a second
 * booking of it for overlapping dates refused with a link to the first, a
 * draft booked later, a booking cancelled, and all of it on the calendar
 * and the car's and Renter's pages. Dates are well in the future, so the
 * day the tests run never matters.
 */
const RENTER_NAME = "Rita Rental";
const CAR_REGO = "E2E201";

interface TypedMoment {
  day: string;
  month: string;
  year: string;
  /** 12-hour clock, two digits. */
  hour: string;
  minute: string;
  meridiem: "a" | "p";
}

/** Types a date and time into a picker part by part, as a keyboard user would. */
async function typeMoment(page: Page, label: RegExp, moment: TypedMoment): Promise<void> {
  const picker = page.getByRole("group", { name: label });
  await picker.getByRole("spinbutton", { name: /day/i }).focus();
  for (const part of [moment.day, moment.month, moment.year, moment.hour, moment.minute]) {
    await page.keyboard.type(part);
  }
  await page.keyboard.type(moment.meridiem);
}

async function pickRecord(page: Page, label: RegExp, typed: string): Promise<void> {
  const box = page.getByRole("combobox", { name: label });
  await box.fill(typed);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
}

/** Fills the New rental form for the test car and Renter, fixed term, between two moments. */
async function fillRental(page: Page, start: TypedMoment, end: TypedMoment): Promise<void> {
  await page.goto("/rentals/new", { waitUntil: "networkidle" });
  await pickRecord(page, /^Renter/, RENTER_NAME);
  await pickRecord(page, /^Car/, CAR_REGO);
  await typeMoment(page, /^Starts/, start);
  await typeMoment(page, /^Ends/, end);
  await page.getByRole("textbox", { name: /^Weekly rate/ }).pressSequentially("350");
  await page.getByRole("textbox", { name: /^Bond/ }).pressSequentially("500");
}

const MARCH_1: TypedMoment = {
  day: "01",
  month: "03",
  year: "2027",
  hour: "09",
  minute: "00",
  meridiem: "a",
};
const MARCH_29 = { ...MARCH_1, day: "29" };
const MARCH_15 = { ...MARCH_1, day: "15" };
const APRIL_5 = { ...MARCH_1, day: "05", month: "04" };
const APRIL_26 = { ...MARCH_1, day: "26", month: "04" };
const MAY_3 = { ...MARCH_1, day: "03", month: "05" };
const MAY_31 = { ...MARCH_1, day: "31", month: "05" };

test.describe.serial("bookings", () => {
  test("sets up a Renter and a car to book", async ({ page }) => {
    await page.goto("/renters/new", { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: /^Full name/ }).fill(RENTER_NAME);
    await page.getByRole("textbox", { name: /^Phone/ }).pressSequentially("0412000201");
    await page.getByRole("button", { name: "Add Renter" }).click();
    await expect(page.getByRole("heading", { name: RENTER_NAME })).toBeVisible();

    await page.goto("/cars/new", { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: /^Rego/ }).fill(CAR_REGO);
    await page.getByLabel(/^State/).selectOption("WA");
    await page.getByRole("combobox", { name: /^Make/ }).fill("toyo");
    await page.getByRole("listbox").getByRole("option", { name: "Toyota" }).click();
    await page.getByRole("combobox", { name: /^Model/ }).fill("corol");
    await page.getByRole("listbox").getByRole("option", { name: "Corolla", exact: true }).click();
    await page.getByRole("textbox", { name: /^Year/ }).fill("2024");
    await page.getByRole("textbox", { name: /^Odometer/ }).pressSequentially("1000");
    await page.getByRole("button", { name: "Add car" }).click();
    await expect(page.getByRole("heading", { name: CAR_REGO })).toBeVisible();
  });

  test("books the car, and lists what is still needed before handover", async ({ page }) => {
    await fillRental(page, MARCH_1, MARCH_29);
    await expectAccessible(page);
    await page.getByRole("button", { name: "Book", exact: true }).click();

    await expect(page.getByRole("heading", { name: `${CAR_REGO} · ${RENTER_NAME}` })).toBeVisible();
    await expect(page.getByText("Booked", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Before handover")).toBeVisible();
    await expect(page.getByText(/Still needed before the car is handed over/)).toBeVisible();
    await expectAccessible(page);
  });

  test("previews the rental's contract, listing details not on file", async ({ page }) => {
    // The contract tests (which run first) set up the default template; make sure of one.
    await page.goto("/settings/contracts", { waitUntil: "networkidle" });
    if ((await page.getByText("Used for new rentals").count()) === 0) {
      await page.getByRole("textbox", { name: /^Name/ }).fill("Rental test contract");
      await page.getByRole("button", { name: "Add template" }).click();
      await expect(page.getByText("Used for new rentals").first()).toBeVisible();
    }
    await page.goto("/rentals", { waitUntil: "networkidle" });
    await page
      .getByRole("link", { name: new RegExp(RENTER_NAME) })
      .first()
      .click();

    await expect(page.getByText(/Not on file yet/)).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Licence number" })).toBeVisible();
    const preview = page.getByRole("link", { name: "Preview contract" });
    await expectPdf(page, await preview.getAttribute("href"));
  });

  test("refuses the same car for overlapping dates, linking to the booking in the way", async ({
    page,
  }) => {
    await fillRental(page, MARCH_15, APRIL_5);
    await page.getByRole("button", { name: "Book", exact: true }).click();

    await expect(page.getByText(/^This car is already booked from/)).toBeVisible();
    await page.getByRole("link", { name: "See that booking" }).click();
    await expect(page.getByRole("heading", { name: `${CAR_REGO} · ${RENTER_NAME}` })).toBeVisible();
  });

  test("saves a draft without holding the car, then books it", async ({ page }) => {
    await fillRental(page, APRIL_5, APRIL_26);
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

    const bookButton = page.getByRole("button", { name: "Book this car" });
    await bookButton.click();
    // The page comes back as a booking: no longer a draft to book.
    await expect(bookButton).toBeHidden();
    await expect(page.getByText("Booked", { exact: true }).first()).toBeVisible();
  });

  test("cancels a booking with a reason, letting the car go", async ({ page }) => {
    await fillRental(page, MAY_3, MAY_31);
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cancel this rental" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel this rental" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel this rental" });
    await dialog.getByRole("textbox", { name: /^Why is it cancelled/ }).fill("Plans changed");
    await dialog.getByRole("button", { name: "Cancel this rental" }).click();
    await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Log" }).click();
    // The Log says the reason was given, never what it was.
    await expect(page.getByText("Why it was cancelled changed")).toBeVisible();
    await expect(page.getByText("Plans changed")).toHaveCount(0);
  });

  test("shows the bookings on the calendar and on the car's and Renter's pages", async ({
    page,
  }) => {
    await page.goto("/rentals/calendar?month=2027-03", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("link", { name: new RegExp(`${CAR_REGO} · ${RENTER_NAME}`) }).first(),
    ).toBeVisible();
    await expectAccessible(page);

    await page.goto("/rentals", { waitUntil: "networkidle" });
    await page.getByRole("searchbox").fill(CAR_REGO);
    await page.keyboard.press("Enter");
    await page
      .getByRole("link", { name: new RegExp(RENTER_NAME) })
      .first()
      .click();
    await page.getByRole("link", { name: new RegExp(`^${CAR_REGO}`) }).click();
    await expect(page.getByRole("heading", { name: CAR_REGO })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Car sections" })
      .getByRole("link", { name: "Rentals" })
      .click();
    // Two bookings and the cancelled one, latest first.
    await expect(page.getByRole("list", { name: "Rentals" }).getByRole("listitem")).toHaveCount(3);
    await expectAccessible(page);
  });

  test("a fixed charge day in Settings is offered on the next New rental form", async ({
    page,
  }) => {
    await page.goto("/settings", { waitUntil: "networkidle" });
    await page.getByLabel(/^Rent is charged each week on/).selectOption({ label: "Monday" });
    const form = page
      .locator("form")
      .filter({ has: page.getByLabel(/^Rent is charged each week on/) });
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByText(/^Saved\./)).toBeVisible();

    await page.goto("/rentals/new", { waitUntil: "networkidle" });
    await expect(page.getByLabel(/^Rent is charged each/)).toContainText("Monday (your usual day)");
  });
});

test.describe("the New rental form at phone width", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("fits the screen, with buttons big enough to tap", async ({ page }) => {
    await page.goto("/rentals/new", { waitUntil: "networkidle" });
    const isScrollingSideways = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(isScrollingSideways).toBe(false);
    for (const name of ["Book", "Save as draft"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);
    }
  });
});
