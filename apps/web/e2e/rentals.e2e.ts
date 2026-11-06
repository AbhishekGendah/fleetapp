import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectPdf } from "./pdf-checks";
import { expectNoSidewaysScroll, expectTappableButtons } from "./phone-checks";
import {
  addCarToBook,
  fillRental,
  openRentalTab,
  type RentalParties,
  type TypedMoment,
} from "./rental-steps";

/**
 * Bookings as an Operator makes them: a car booked for a Renter, a second
 * booking of it for overlapping dates refused with a link to the first, a
 * draft booked later, a booking cancelled, and all of it on the calendar
 * and the car's and Renter's pages. Dates are well in the future, so the
 * day the tests run never matters.
 */
const RENTER_NAME = "Rita Rental";
const CAR_REGO = "E2E201";
const PARTIES: RentalParties = { renterName: RENTER_NAME, carRego: CAR_REGO };

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
    await expect(page.getByRole("heading", { name: RENTER_NAME, exact: true })).toBeVisible();

    await addCarToBook(page, CAR_REGO);
  });

  test("books the car, and lists what is still needed before handover", async ({ page }) => {
    await fillRental(page, PARTIES, MARCH_1, MARCH_29);
    await expectAccessible(page);
    await page.getByRole("button", { name: "Book", exact: true }).click();

    await expect(page.getByRole("heading", { name: `${CAR_REGO} · ${RENTER_NAME}` })).toBeVisible();
    await expect(page.getByText(/^Booked · handover /)).toBeVisible();
    await expect(page.getByText("Before handover", { exact: true })).toBeVisible();
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
    await openRentalTab(page, "Papers");

    await expect(page.getByText(/Not on file yet/)).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Licence number" })).toBeVisible();
    const preview = page.getByRole("link", { name: "Preview contract" });
    await expectPdf(page, await preview.getAttribute("href"));
  });

  test("records bond received, lists the rest before handover, and corrects an entry", async ({
    page,
  }) => {
    await page.goto("/rentals", { waitUntil: "networkidle" });
    await page
      .getByRole("link", { name: new RegExp(RENTER_NAME) })
      .first()
      .click();
    const bondLine = (label: string) =>
      page.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]");
    await openRentalTab(page, "Money");
    await expect(page.getByText("Bond still to receive before handover: $500.00.")).toBeVisible();

    await page.getByRole("button", { name: "Record bond received" }).click();
    const dialog = page.getByRole("dialog", { name: "Record bond received" });
    const amount = dialog.getByRole("textbox", { name: /^Amount/ });
    await expect(amount).toHaveValue("$500.00");
    await amount.fill("");
    await amount.pressSequentially("200");
    const reference = dialog.getByRole("textbox", { name: /^Reference/ });
    await reference.pressSequentially("ref 42");
    await expect(reference).toHaveValue("REF 42");
    await expectAccessible(page);
    await dialog.getByRole("button", { name: "Record bond" }).click();

    await expect(bondLine("Held now")).toHaveText("$200.00");
    await expect(bondLine("Still to receive")).toHaveText("$300.00");
    await expect(page.getByText("Bond still to receive before handover: $300.00.")).toBeVisible();
    await expect(page.getByText("Reference REF 42")).toBeVisible();

    await page.getByRole("button", { name: "Correct", exact: true }).click();
    const correction = page.getByRole("dialog", { name: "Correct this bond entry" });
    await correction
      .getByRole("textbox", { name: /^Why is it being corrected/ })
      .fill("Wrong rental");
    await correction.getByRole("button", { name: "Correct this entry" }).click();

    await expect(bondLine("Held now")).toHaveText("$0.00");
    await expect(page.getByText("Corrected", { exact: true })).toBeVisible();
    await expect(page.getByText("Why: Wrong rental")).toBeVisible();
    await expect(page.getByRole("button", { name: "Correct", exact: true })).toHaveCount(0);
    await expectAccessible(page);

    await page.getByRole("link", { name: "Log" }).click();
    await expect(page.getByText(/Bond entry added/).first()).toBeVisible();
    await expect(page.getByText("Wrong rental")).toHaveCount(0);
  });

  test("refuses the same car for overlapping dates, linking to the booking in the way", async ({
    page,
  }) => {
    await fillRental(page, PARTIES, MARCH_15, APRIL_5);
    await page.getByRole("button", { name: "Book", exact: true }).click();

    await expect(page.getByText(/^This car is already booked from/)).toBeVisible();
    await page.getByRole("link", { name: "See that booking" }).click();
    await expect(page.getByRole("heading", { name: `${CAR_REGO} · ${RENTER_NAME}` })).toBeVisible();
  });

  test("saves a draft without holding the car, then books it", async ({ page }) => {
    await fillRental(page, PARTIES, APRIL_5, APRIL_26);
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

    const bookButton = page.getByRole("button", { name: "Book this car" });
    await bookButton.click();
    // The page comes back as a booking: no longer a draft to book.
    await expect(bookButton).toBeHidden();
    await expect(page.getByText(/^Booked · handover /)).toBeVisible();
  });

  test("cancels a booking with a reason, letting the car go", async ({ page }) => {
    await fillRental(page, PARTIES, MAY_3, MAY_31);
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
    await page
      .getByRole("link", { name: new RegExp(`^${CAR_REGO}`) })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: CAR_REGO })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Car sections" })
      .getByRole("link", { name: "Rentals" })
      .click();
    // Two bookings and the cancelled one, latest first.
    await expect(page.getByRole("list", { name: "Rentals" }).getByRole("listitem")).toHaveCount(3);
    await expectAccessible(page);
  });

  test("the long-term minimum in Settings is used on the next New rental form", async ({
    page,
  }) => {
    await page.goto("/settings", { waitUntil: "networkidle" });
    const minimum = page.getByRole("textbox", { name: /^Rentals booked for at least/ });
    await minimum.fill("14");
    const form = page.locator("form").filter({ has: minimum });
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByText(/^Saved\./)).toBeVisible();

    await page.goto("/rentals/new", { waitUntil: "networkidle" });
    await expect(
      page.getByText(/Booked for 14 days or more, a rental gets the long-term price/),
    ).toBeVisible();
  });
});

test.describe("rentals at phone width", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("fits the screen, with buttons big enough to tap", async ({ page }) => {
    await page.goto("/rentals/new", { waitUntil: "networkidle" });
    await expectNoSidewaysScroll(page);
    await expectTappableButtons(page, ["Book", "Save as draft"]);
  });

  test("a rental's page, with its bond, fits the screen", async ({ page }) => {
    // A booking still waiting for its bond, so the bond card has its button.
    await page.goto("/rentals?status=booked", { waitUntil: "networkidle" });
    await page
      .getByRole("link", { name: new RegExp(RENTER_NAME) })
      .first()
      .click();
    await openRentalTab(page, "Money");
    await expect(page.getByRole("heading", { name: "Bond", exact: true })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectTappableButtons(page, ["Record bond received"]);
  });
});
