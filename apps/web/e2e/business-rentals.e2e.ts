import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import {
  addBusiness,
  addCarToBook,
  addRenterReadyToRent,
  fillCarDatesAndRates,
  openBusinessPage,
  openBusinessRentalOf,
  openRentalTab,
  type TypedMoment,
} from "./rental-steps";
import { openLinkOnPhone, writeShortTemplate } from "./signing-steps";
import { latestEmailTo } from "./test-inbox";

/**
 * Renting to a business (docs/plans/business-renters.md slice 3, mockups 5
 * and 6): New rental from the business's strip, the driver picker with
 * "Driver to be named" by keyboard, the rental page naming the business and
 * "driver to be named", the Next step's Name a driver, and the business
 * contract signed on the contact's phone by an authorised person with their
 * position. At phone width.
 */
const BUSINESS = {
  legalName: "Osprey Rideshare Pty Ltd",
  tradingName: "Osprey Rides",
  abnDigits: "53004085616",
  contactName: "Olive Osprey",
  email: "olive.osprey@example.test",
};
const DRIVER = {
  name: "Ollie Driver",
  email: "ollie.driver@example.test",
  phone: "0412000991",
  licenceNumber: "WA9900991",
};
const CAR_REGO = "E2E991";
const TEMPLATE_NAME = "Short business contract";
const LINK_PATTERN = /https?:\/\/\S+\/r\/[A-Za-z0-9_-]+/;
/**
 * The New rental form's JavaScript budget with a business chosen and its
 * driver picker loaded (rule 33): 542 KB measured on 8 Nov 2026 plus about
 * 10%. The picker (the shared choice cards) loads only once a business is
 * chosen, so the plain form keeps its 510 KB budget (download-size.e2e.ts).
 */
const NEW_RENTAL_BUDGET_KB = 595;

const START: TypedMoment = {
  day: "07",
  month: "09",
  year: "2027",
  hour: "09",
  minute: "00",
  meridiem: "a",
};
const END = { ...START, day: "05", month: "10" };

async function openBusiness(page: Page): Promise<void> {
  await openBusinessPage(page, { search: "osprey", tradingName: BUSINESS.tradingName });
  await page.waitForLoadState("networkidle");
}

/** The business's rental of the test car, from the Rentals list. */
async function openBusinessRental(page: Page): Promise<void> {
  await openBusinessRentalOf(page, { carRego: CAR_REGO, tradingName: BUSINESS.tradingName });
}

test.describe.serial("renting to a business", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("sets up a business with a driver ready to rent, and a car", async ({ page }) => {
    await addRenterReadyToRent(page, DRIVER);
    await addBusiness(page, BUSINESS);
    const driversTab = page
      .getByRole("navigation", { name: "Business sections" })
      .getByRole("link", { name: "Drivers", exact: true });
    await driversTab.click();
    await expect(driversTab).toHaveAttribute("aria-current", "page");
    // The Add a driver form loads with the tab: wait for it before typing.
    await page.waitForLoadState("networkidle");
    await page.getByRole("combobox", { name: /^Renter/ }).fill("Ollie");
    await page.getByRole("option", { name: new RegExp(DRIVER.name) }).click();
    await page.getByRole("button", { name: "Add driver" }).click();
    await expect(page.getByText("Driver added.")).toBeVisible();
    await addCarToBook(page, CAR_REGO);
  });

  test("books from the business's strip, the driver to be named, by keyboard", async ({ page }) => {
    await openBusiness(page);
    await page
      .getByRole("region", { name: BUSINESS.tradingName })
      .getByRole("link", { name: "New rental" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "New rental" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(
        `The contract goes to ${BUSINESS.contactName} to sign for ${BUSINESS.legalName}.`,
      ),
    ).toBeVisible();
    const drivers = page.getByRole("radiogroup", { name: /^Driver/ });
    const toBeNamed = drivers.getByRole("radio", { name: /^Driver to be named/ });
    const driver = drivers.getByRole("radio", { name: new RegExp(`^${DRIVER.name}`) });
    await expect(toBeNamed).toBeChecked();
    await toBeNamed.focus();
    await page.keyboard.press("ArrowDown");
    await expect(driver).toBeChecked();
    await page.keyboard.press("ArrowUp");
    await expect(toBeNamed).toBeChecked();
    await expect(
      page.getByRole("link", { name: `+ Add a driver to ${BUSINESS.tradingName}` }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
    expect(await scriptKilobytes(page)).toBeLessThanOrEqual(NEW_RENTAL_BUDGET_KB);

    await fillCarDatesAndRates(page, { carRego: CAR_REGO, start: START, end: END });
    await page.getByRole("button", { name: "Book", exact: true }).click();

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText(`${CAR_REGO} · ${BUSINESS.tradingName}`);
    await expect(heading).toContainText("driver to be named");
    await expect(page.getByText("No driver named yet", { exact: true })).toBeVisible();
    await expect(page.getByText(/The handover can.t start until a driver is named/)).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });

  test("names the driver from the Next step, and the rental then names them", async ({ page }) => {
    await openBusinessRental(page);
    // The Next step's main button (the contract is still to sign, so the Rental card's).
    await page.getByRole("button", { name: "Name a driver" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Name a driver" });
    await expect(dialog).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole("radio", { name: new RegExp(`^${DRIVER.name}`) }).click();
    await dialog.getByRole("button", { name: "Save driver" }).click();
    // Saved with what is still needed (the business has no address on file): the pop-up stays to be read.
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "Saved. Before the handover: Still needed on the business's details",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText(`driver ${DRIVER.name}`);
    await expect(page.getByText(`Driver named: ${DRIVER.name}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Change driver" })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);

    // The business's Rentals tab names who drives each car.
    await openBusiness(page);
    await page
      .getByRole("navigation", { name: "Business sections" })
      .getByRole("link", { name: "Rentals", exact: true })
      .click();
    await expect(
      page.getByText(new RegExp(`${CAR_REGO} · .* · driver ${DRIVER.name}`)).first(),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test("sends the business contract, signed for the business with a position", async ({
    page,
    browser,
  }) => {
    await writeShortTemplate(page, {
      name: TEMPLATE_NAME,
      kind: "business_contract",
      opening: "Business agreement for ",
      nameField: "Business Renter's legal name",
    });

    await openBusinessRental(page);
    await openRentalTab(page, "Papers");
    await page.getByRole("button", { name: "Send for signing" }).click();
    await expect(page.getByText(/^Emailed\. It works until/)).toBeVisible();

    const email = await latestEmailTo(BUSINESS.email);
    expect(email.text).toContain(`Hi ${BUSINESS.contactName},`);
    const phone = await openLinkOnPhone(browser, LINK_PATTERN.exec(email.text)?.[0] ?? "", {
      email: BUSINESS.email,
      pageTitle: "Your rental contract",
    });
    await expect(phone.getByRole("group", { name: "1. Check the details" })).toBeVisible();
    await phone.waitForLoadState("networkidle");
    await expect(
      phone.getByRole("article", { name: "The business rental contract" }),
    ).toContainText(`Business agreement for ${BUSINESS.legalName}, who rents ${CAR_REGO}`);
    await expect(phone.getByRole("textbox", { name: /^Your full name/ })).toHaveValue(
      BUSINESS.contactName,
    );
    await expectAccessible(phone);
    await expectNoSidewaysScroll(phone);

    await phone.getByRole("checkbox", { name: /The details above are right/ }).check();
    await phone
      .getByRole("checkbox", { name: /I agree to sign this contract electronically/ })
      .check();
    const signButton = phone.getByRole("button", { name: "Sign the contract" });
    await signButton.click();
    // No position and no authority tick yet: refused, each said under its own box.
    await expect(phone.getByText(/^Enter your position/)).toBeVisible();
    await phone.getByRole("textbox", { name: /^Your position/ }).fill("Director");
    await phone
      .getByRole("checkbox", { name: `I am authorised to sign for ${BUSINESS.legalName}.` })
      .check();
    await phone.getByLabel(/^How do you want to sign/).selectOption("typed");
    await phone
      .getByRole("textbox", { name: /^Your signature: your full name typed/ })
      .fill(BUSINESS.contactName);
    await signButton.click();
    await expect(phone.getByText("Signed. Thank you.")).toBeVisible();
    await expectAccessible(phone);
    await phone.context().close();

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText("Business rental contract").first()).toBeVisible();
  });
});
