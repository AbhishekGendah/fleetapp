import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import {
  addCarToBook,
  addRenterReadyToRent,
  openBusinessPage,
  typeMoment,
  type TypedMoment,
} from "./rental-steps";
import { drawRenterSignature } from "./signing-steps";
import { latestEmailTo } from "./test-inbox";
import { recordHandover, recordSignedContract } from "./test-records";

/**
 * Changing a business's driver while its car is out (docs/plans/
 * business-renters.md slice 4, mockup 7), on the Operator's phone: Change
 * driver from the rental's strip, the new driver chosen by keyboard with a
 * reason, the car checked in from the driver who has it, then both sign
 * and the rental names the new driver, with who had the car when.
 */
const BUSINESS = {
  legalName: "Heron Rideshare Pty Ltd",
  tradingName: "Heron Rides",
  abnDigits: "51824753556",
  contactName: "Hana Heron",
  email: "hana.heron@example.test",
};
const SAM = {
  name: "Sam Heron",
  email: "sam.heron@example.test",
  phone: "0412000971",
  licenceNumber: "WA9700971",
};
const MIA = {
  name: "Mia Heron",
  email: "mia.heron@example.test",
  phone: "0412000972",
  licenceNumber: "WA9700972",
};
const CAR_REGO = "E2E971";
/**
 * Each step's JavaScript, compressed: the check-in is the handover
 * checklist's page (its 730 KB budget, 2 Nov 2026); the first and last
 * steps carry less (the choice cards; the signature pads load only once the
 * check-in is done) and are held to the same budget, as one flow.
 */
const DRIVER_CHANGE_PAGE_BUDGET_KB = 730;

const START: TypedMoment = {
  day: "06",
  month: "09",
  year: "2027",
  hour: "09",
  minute: "00",
  meridiem: "a",
};
const END = { ...START, day: "04", month: "10" };

/** The business's rental of the test car, from the Rentals list. */
async function openBusinessRental(page: Page): Promise<string> {
  await page.goto(`/rentals?q=${CAR_REGO}`, { waitUntil: "networkidle" });
  await page
    .getByRole("link", { name: new RegExp(`^${BUSINESS.tradingName}'s rental, `) })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(CAR_REGO) })).toBeVisible();
  await page.waitForLoadState("networkidle");
  return /\/rentals\/([0-9a-f-]+)/.exec(page.url())?.[1] ?? "";
}

async function addDriverOnTab(page: Page, driver: { name: string }): Promise<void> {
  await page.getByRole("combobox", { name: /^Renter/ }).fill(driver.name.split(" ")[0]!);
  await page.getByRole("option", { name: new RegExp(driver.name) }).click();
  await page.getByRole("button", { name: "Add driver" }).click();
  await expect(page.getByText("Driver added.")).toBeVisible();
}

async function checkStep(page: Page, step: RegExp): Promise<void> {
  await expect(page.getByText(step)).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await scriptKilobytes(page)).toBeLessThanOrEqual(DRIVER_CHANGE_PAGE_BUDGET_KB);
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);
}

test.describe.serial("changing a business's driver", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("sets up a business with two drivers, and its car out with the first", async ({ page }) => {
    await addRenterReadyToRent(page, SAM);
    await addRenterReadyToRent(page, MIA);
    await page.goto("/renters/new?kind=business", { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: /^Legal name/ }).fill(BUSINESS.legalName);
    await page.getByRole("textbox", { name: /^Trading name/ }).fill(BUSINESS.tradingName);
    await page.getByRole("textbox", { name: /^ABN/ }).pressSequentially(BUSINESS.abnDigits);
    await page.getByRole("textbox", { name: /^Contact's name/ }).fill(BUSINESS.contactName);
    await page.getByRole("textbox", { name: /^Contact's email/ }).fill(BUSINESS.email);
    await page.getByRole("button", { name: "Add business" }).click();
    await expect(page.getByRole("heading", { level: 1, name: BUSINESS.tradingName })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Business sections" })
      .getByRole("link", { name: "Drivers", exact: true })
      .click();
    await page.waitForLoadState("networkidle");
    await addDriverOnTab(page, SAM);
    await addDriverOnTab(page, MIA);
    await addCarToBook(page, CAR_REGO);

    await openBusinessPage(page, { search: "heron", tradingName: BUSINESS.tradingName });
    await page
      .getByRole("region", { name: BUSINESS.tradingName })
      .getByRole("link", { name: "New rental" })
      .click();
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("radiogroup", { name: /^Driver/ })
      .getByRole("radio", { name: new RegExp(`^${SAM.name}`) })
      .click();
    await page.getByRole("combobox", { name: /^Car/ }).fill(CAR_REGO);
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await typeMoment(page, /^Starts/, START);
    await typeMoment(page, /^Ends/, END);
    await page.getByRole("textbox", { name: /^Daily rate/ }).fill("70");
    await page.getByRole("textbox", { name: /^Long-term price per week/ }).fill("350");
    await page.getByRole("textbox", { name: /^Bond/ }).pressSequentially("500");
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`driver ${SAM.name}`);

    const rentalId = await openBusinessRental(page);
    await recordSignedContract(rentalId);
    await recordHandover(rentalId);
  });

  test("chooses the new driver by keyboard and why, then checks the car in", async ({ page }) => {
    await openBusinessRental(page);
    await page
      .getByRole("region", { name: new RegExp(CAR_REGO) })
      .getByRole("link", { name: "Change driver" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Change driver" })).toBeVisible();
    await checkStep(page, /^Step 1 of 3: Why and who/);
    const drivers = page.getByRole("radiogroup", {
      name: new RegExp(`^Who drives ${CAR_REGO} next`),
    });
    await expect(drivers.getByRole("radio")).toHaveCount(1);
    await page.getByRole("button", { name: "Next: check the car in" }).click();
    await expect(page.getByText("Choose who drives the car next.")).toBeVisible();
    const mia = drivers.getByRole("radio", { name: new RegExp(`^${MIA.name}`) });
    await mia.focus();
    await page.keyboard.press("Space");
    await expect(mia).toBeChecked();
    await page.getByRole("textbox", { name: /^Why the change/ }).fill("Sam moved to night shifts.");
    await page.getByRole("button", { name: "Next: check the car in" }).click();

    await checkStep(page, /^Step 2 of 3: Check in from Sam/);
    await page.getByRole("textbox", { name: /^Odometer/ }).pressSequentially("1400");
    await page.getByLabel(/^Fuel/).selectOption("full");
    await page.getByRole("textbox", { name: /^Keys/ }).fill("2");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Next: Mia signs" }).click();
    await checkStep(page, /^Step 3 of 3: Mia signs/);
  });

  test("both drivers sign, and the rental names the new driver from that moment", async ({
    page,
  }) => {
    await openBusinessRental(page);
    await page.getByRole("link", { name: "Continue driver change" }).first().click();
    await page.getByRole("link", { name: "Next: Mia signs" }).click();
    await expect(page.getByText(`${MIA.name} drives for ${BUSINESS.tradingName}`)).toBeVisible();
    await expect(
      page.getByText(`I, ${SAM.name}, returned this car for ${BUSINESS.legalName} on the date`),
    ).toBeVisible();
    await expect(
      page.getByText(`I, ${MIA.name}, received this car for ${BUSINESS.legalName} on the date`),
    ).toBeVisible();
    const finish = page.getByRole("button", { name: "Finish driver change" });
    await finish.click();
    await expect(page.getByText(/^Ask the Renter to sign in the box/)).toBeVisible();
    await page.getByLabel(`How ${SAM.name} signs`).selectOption("typed");
    await page.getByRole("textbox", { name: `${SAM.name}'s full name` }).fill(SAM.name);
    await drawRenterSignature(page);
    await expectAccessible(page);
    await finish.click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText(`driver ${MIA.name}`);
    const who = page.getByRole("region", { name: "Who had the car" });
    await expect(who.getByRole("listitem")).toHaveCount(2);
    await expect(who.getByRole("listitem").first()).toContainText(MIA.name);
    await expect(who.getByRole("listitem").first()).toContainText("Has it");
    await expect(page.getByText(`${SAM.name} → ${MIA.name}`)).toBeVisible();
    for (const name of [/^Open check-in report/, /^Open handover report \(/]) {
      const paper = page.getByRole("link", { name });
      const response = await page.request.get((await paper.getAttribute("href")) ?? "");
      expect(response.headers()["content-type"]).toBe("application/pdf");
    }
    expect((await latestEmailTo(MIA.email)).subject).toMatch(/handover report/);
    expect((await latestEmailTo(SAM.email)).subject).toMatch(/return report/);
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });
});
