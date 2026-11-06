import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { openRentalPage, rentalOutAndCharged } from "./money-steps";
import { expectNoSidewaysScroll } from "./phone-checks";
import {
  addCarToBook,
  addRenterReadyToRent,
  fillRental,
  morningInDays,
  openRentalTab,
  rentalIdOnPage,
  type RentalParties,
  type RentalTabName,
} from "./rental-steps";
import { recordSignedContract } from "./test-records";

/**
 * One rental's page in the agreed look (docs/plans/look-and-feel.md, "One
 * rental's page"): the navy strip with rego · Renter as links, the status in
 * plain words and the key facts; the Next step's ticks and main button; the
 * Overview, Money, Papers and Log tabs by keyboard and by address; and every
 * tab at phone and computer width.
 */
const READY = {
  name: "Rhea Ready",
  email: "rhea.ready@example.test",
  phone: "0412009001",
  licenceNumber: "7659001",
};
const READY_PARTIES: RentalParties = { renterName: READY.name, carRego: "E2E9101" };
const OUT = { name: "Otto Out", email: "otto.out@example.test", phone: "0412009002" };
const OUT_PARTIES: RentalParties = { renterName: OUT.name, carRego: "E2E9102" };
/** The rental page's JavaScript, compressed: as in money.e2e.ts and changes.e2e.ts. */
const RENTAL_PAGE_BUDGET_KB = 400;
const TABS: readonly RentalTabName[] = ["Overview", "Money", "Papers", "Log"];

let bookedId = "";
let outId = "";

/** The navy strip: the region named by the page's heading. */
function strip(page: Page, parties: RentalParties) {
  return page.getByRole("region", { name: `${parties.carRego} · ${parties.renterName}` });
}

function tabLink(page: Page, tab: RentalTabName) {
  return page
    .getByRole("navigation", { name: "Rental sections" })
    .getByRole("link", { name: tab, exact: true });
}

/** Each tab in turn: it fits the screen, passes axe and keeps to the page's budget. */
async function checkEveryTab(page: Page, rentalId: string, parties: RentalParties) {
  await openRentalPage(page, rentalId, parties);
  for (const tab of TABS) {
    await openRentalTab(page, tab);
    expect(await scriptKilobytes(page)).toBeLessThanOrEqual(RENTAL_PAGE_BUDGET_KB);
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  }
}

test.describe.serial("one rental's page", () => {
  test("sets up a booking ready but for its bond, and a rental out", async ({ page }) => {
    await addRenterReadyToRent(page, READY);
    await addCarToBook(page, READY_PARTIES.carRego);
    await fillRental(page, READY_PARTIES, morningInDays(2), morningInDays(30));
    await page.getByRole("button", { name: "Book", exact: true }).click();
    bookedId = await rentalIdOnPage(page, READY_PARTIES);
    await recordSignedContract(bookedId);

    outId = await rentalOutAndCharged(page, OUT, OUT_PARTIES);
  });

  test("the strip names the car and the Renter as links, with the status and facts", async ({
    page,
  }) => {
    await openRentalPage(page, bookedId, READY_PARTIES);
    const top = strip(page, READY_PARTIES);
    await expect(top.getByText(/^Booked · handover /)).toBeVisible();
    await expect(top.getByText("Toyota Corolla · weekly, ends ")).toBeVisible();
    for (const label of ["Handover", "Rent", "Bond"]) {
      await expect(top.getByRole("term").filter({ hasText: label })).toBeVisible();
    }
    await expect(top.getByText("$350.00", { exact: true })).toBeVisible();
    await expect(top.getByText("Not paid yet", { exact: true })).toBeVisible();

    await top.getByRole("link", { name: READY_PARTIES.carRego, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: new RegExp(`^${READY_PARTIES.carRego} `), level: 1 }),
    ).toBeVisible();
    await openRentalPage(page, bookedId, READY_PARTIES);
    await strip(page, READY_PARTIES).getByRole("link", { name: READY.name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: new RegExp(`^${READY.name}`), level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/renters\//);
  });

  test("the Next step ticks what is done, opens what is missing, then offers Start handover", async ({
    page,
  }) => {
    await openRentalPage(page, bookedId, READY_PARTIES);
    const ticks = page.getByRole("list", { name: "What is ready" });
    await expect(ticks.getByText(/^Contract signed /)).toBeVisible();
    await expect(ticks.getByText("Bond not paid yet: $500.00 to pay")).toBeVisible();
    await expect(ticks.getByText("Rhea's details approved")).toBeVisible();
    // Still offered beside the missing bond, so a reason can be given at the handover.
    await expect(page.getByRole("button", { name: "Start handover" })).toHaveCount(1);

    await page.getByRole("link", { name: "Take the bond" }).click();
    await expect(page).toHaveURL(/\?tab=money$/);
    await expect(tabLink(page, "Money")).toHaveAttribute("aria-current", "page");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Record bond received" }).click();
    const dialog = page.getByRole("dialog", { name: "Record bond received" });
    await expect(dialog.getByRole("textbox", { name: /^Amount/ })).toHaveValue("$500.00");
    await dialog.getByRole("button", { name: "Record bond" }).click();
    await expect(dialog).toBeHidden();

    await openRentalTab(page, "Overview");
    await expect(ticks.getByText("Bond paid", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Take the bond" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start handover" })).toHaveCount(1);
    await expect(strip(page, READY_PARTIES).getByText("Paid", { exact: true })).toBeVisible();
  });

  test("the tabs switch by keyboard and by address; an old Summary address opens Overview", async ({
    page,
  }) => {
    await openRentalPage(page, bookedId, READY_PARTIES);
    await expect(tabLink(page, "Overview")).toHaveAttribute("aria-current", "page");
    await tabLink(page, "Money").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\?tab=money$/);
    await expect(tabLink(page, "Money")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Charges and payments" })).toBeVisible();

    await page.goto(`/rentals/${bookedId}?tab=summary`, { waitUntil: "networkidle" });
    await expect(tabLink(page, "Overview")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Rental", exact: true })).toBeVisible();

    await page.goto(`/rentals/${bookedId}?tab=papers`, { waitUntil: "networkidle" });
    await expect(tabLink(page, "Papers")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Open signed contract" })).toBeVisible();
    await expect(page.getByText("Made when the car is handed over.")).toBeVisible();

    await page.goto(`/rentals/${bookedId}?tab=log`, { waitUntil: "networkidle" });
    await expect(tabLink(page, "Log")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Log", exact: true })).toBeVisible();
  });

  test("a rental out shows what is owing, the bond, the kilometres at handover and Start return", async ({
    page,
  }) => {
    await openRentalPage(page, outId, OUT_PARTIES);
    const top = strip(page, OUT_PARTIES);
    await expect(top.getByText(/^Out since /)).toBeVisible();
    await expect(top.getByRole("term").filter({ hasText: "Owing" })).toBeVisible();
    await expect(top.getByText("1,000 km", { exact: true })).toBeVisible();
    await expect(top.getByText("Fuel full", { exact: true })).toBeVisible();
    await expect(top.getByRole("button", { name: "Start return" })).toBeVisible();
    await expect(page.getByRole("list", { name: "What is ready" })).toHaveCount(0);

    // On a computer, the Overview's latest money opens the Money tab.
    await page.getByRole("link", { name: "All money" }).click();
    await expect(page).toHaveURL(/\?tab=money$/);
    await expect(tabLink(page, "Money")).toHaveAttribute("aria-current", "page");
  });

  test("every tab passes the accessibility check on a computer", async ({ page }) => {
    await checkEveryTab(page, bookedId, READY_PARTIES);
    await checkEveryTab(page, outId, OUT_PARTIES);
  });

  test.describe("on the Operator's phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("every tab fits the screen and passes the accessibility check", async ({ page }) => {
      await checkEveryTab(page, bookedId, READY_PARTIES);
      await checkEveryTab(page, outId, OUT_PARTIES);
    });

    test("the strip's links stay links on a phone, and its main button is full width", async ({
      page,
    }) => {
      await openRentalPage(page, outId, OUT_PARTIES);
      const top = strip(page, OUT_PARTIES);
      await expect(top.getByRole("link", { name: OUT_PARTIES.carRego, exact: true })).toBeVisible();
      await expect(top.getByRole("link", { name: OUT.name, exact: true })).toBeVisible();
      const button = await top.getByRole("button", { name: "Start return" }).boundingBox();
      const width = page.viewportSize()?.width ?? 0;
      expect(button?.width ?? 0).toBeGreaterThan(width / 2);
    });
  });
});
