import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import { addRenter } from "./rental-steps";

/**
 * Business Renters and their drivers (docs/plans/business-renters.md slice
 * 2, 7 Nov 2026 mockups): Person or Business when adding a Renter, the
 * business form with its ABN grouped and checked, the business's page and
 * tabs, the Drivers tab (add someone new or already on file, remove one with
 * no car), the friendly refusals for archiving, a driver's Drives for, the
 * list's labels and filters, search by ABN, and New rental not offering a
 * business yet. At phone width and by keyboard.
 */
const BUSINESS = {
  legalName: "Kestrel Rideshare Pty Ltd",
  tradingName: "Kestrel Rides",
  abnDigits: "53004085616",
  abnShown: "53 004 085 616",
  contactName: "Dana Kestrel",
  email: "dana.kestrel@example.test",
};
const EXISTING_DRIVER = {
  name: "Nora Existing",
  email: "nora.existing@example.test",
  phone: "0412000981",
};
const NEW_DRIVER = { name: "Ned Newdriver", email: "ned.newdriver@example.test" };
const TAB_NAMES = ["Overview", "Drivers", "Rentals", "Money", "Details", "Notes", "Log"];
/**
 * A business's page's JavaScript budget, compressed (rule 33), on the
 * Drivers tab at phone width with its Add a driver form loaded: 403 KB
 * measured on 8 Nov 2026 plus about 10%, the same as a person's page.
 */
const BUSINESS_PAGE_BUDGET_KB = 445;

function businessTab(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Business sections" })
    .getByRole("link", { name, exact: true });
}

async function openBusiness(page: Page, tab = "Overview"): Promise<void> {
  await page.goto("/renters?q=kestrel&status=businesses", { waitUntil: "networkidle" });
  await page
    .getByRole("link", { name: BUSINESS.tradingName, exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: BUSINESS.tradingName })).toBeVisible();
  if (tab !== "Overview") {
    await businessTab(page, tab).click();
    await expect(businessTab(page, tab)).toHaveAttribute("aria-current", "page");
  }
  await page.waitForLoadState("networkidle");
}

test.describe.serial("business Renters and their drivers", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("adds a business by keyboard: Business first, the ABN grouped and checked", async ({
    page,
  }) => {
    await addRenter(page, EXISTING_DRIVER);
    await page.goto("/renters/new", { waitUntil: "networkidle" });
    const kind = page.getByRole("radiogroup", { name: /^Person or business/ });
    await expect(kind.getByRole("radio", { name: /^Person/ })).toBeChecked();
    await kind.getByRole("radio", { name: /^Person/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(kind.getByRole("radio", { name: /^Business/ })).toBeChecked();
    await expect(page.getByRole("textbox", { name: /^Legal name/ })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);

    await page.getByRole("textbox", { name: /^Legal name/ }).fill(BUSINESS.legalName);
    await page.getByRole("textbox", { name: /^Trading name/ }).fill(BUSINESS.tradingName);
    const abn = page.getByRole("textbox", { name: /^ABN/ });
    await abn.pressSequentially("53004085617");
    await expect(abn).toHaveValue("53 004 085 617");
    await page.getByRole("textbox", { name: /^Contact's name/ }).fill(BUSINESS.contactName);
    await expect(page.getByText("That is not a valid ABN. Check the 11 digits.")).toBeVisible();
    await abn.fill("");
    await abn.pressSequentially(BUSINESS.abnDigits);
    await expect(abn).toHaveValue(BUSINESS.abnShown);
    await page.getByRole("textbox", { name: /^Contact's email/ }).fill(BUSINESS.email);
    await page.getByRole("button", { name: "Add business" }).press("Enter");

    await expect(page.getByRole("heading", { level: 1, name: BUSINESS.tradingName })).toBeVisible();
    const strip = page.getByRole("region", { name: BUSINESS.tradingName });
    await expect(strip).toContainText(BUSINESS.legalName);
    await expect(strip).toContainText(`ABN ${BUSINESS.abnShown}`);
    await expect(strip.getByText("Business", { exact: true })).toBeVisible();
    for (const fact of ["Owing across cars", "Cars out", "With you since"]) {
      await expect(strip.getByText(fact, { exact: true })).toBeVisible();
    }
    await expect(strip.getByRole("link", { name: "Email", exact: true })).toHaveAttribute(
      "href",
      `mailto:${BUSINESS.email}`,
    );
    // No New rental for a business until renting to one is built (plan slice 3).
    await expect(strip.getByRole("link", { name: /New rental/ })).toHaveCount(0);
    await expect(page.getByText("Still needed before renting")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });

  test("adds a driver already on file and someone new, each with their standing", async ({
    page,
  }) => {
    await openBusiness(page, "Drivers");
    await page.getByRole("combobox", { name: /^Renter/ }).fill("Nora");
    await page.getByRole("option", { name: new RegExp(EXISTING_DRIVER.name) }).click();
    await page.getByRole("button", { name: "Add driver" }).click();
    await expect(page.getByText("Driver added.")).toBeVisible();
    const current = page.getByRole("list", { name: "Current drivers" });
    await expect(
      current.getByRole("listitem").filter({ hasText: EXISTING_DRIVER.name }),
    ).toContainText("Licence not on file");

    const source = page.getByRole("radiogroup", { name: /^Who drives for it/ });
    await source.getByRole("radio", { name: /^Someone new/ }).click();
    await page.getByRole("textbox", { name: /^Full name/ }).fill(NEW_DRIVER.name);
    await page.getByRole("textbox", { name: /^Email/ }).fill(NEW_DRIVER.email);
    await page.getByRole("button", { name: "Add and send details link" }).click();
    await expect(page.getByText(/^Driver added\. Their details link is on its way/)).toBeVisible();
    await expect(current.getByRole("listitem").filter({ hasText: NEW_DRIVER.name })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
    expect(await scriptKilobytes(page)).toBeLessThanOrEqual(BUSINESS_PAGE_BUDGET_KB);
  });

  test("labels the business and its drivers on the list, and filters and finds them", async ({
    page,
  }) => {
    await page.goto(`/renters?q=${encodeURIComponent(BUSINESS.abnShown)}`, {
      waitUntil: "networkidle",
    });
    const card = page.getByRole("listitem").filter({ hasText: BUSINESS.tradingName });
    await expect(card.getByText("Business", { exact: true })).toBeVisible();

    await page.goto("/renters?q=nora&status=drivers", { waitUntil: "networkidle" });
    const driver = page.getByRole("listitem").filter({ hasText: EXISTING_DRIVER.name });
    await expect(driver.getByText(`Driver for ${BUSINESS.tradingName}`)).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });

  test("keeps each tab of the business opening by keyboard and passing the check", async ({
    page,
  }) => {
    await openBusiness(page);
    for (const name of TAB_NAMES) {
      await businessTab(page, name).focus();
      await page.keyboard.press("Enter");
      await expect(businessTab(page, name)).toHaveAttribute("aria-current", "page");
      await page.waitForLoadState("networkidle");
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
    }
  });

  test("refuses archiving with drivers, with the reason, from both sides", async ({ page }) => {
    await openBusiness(page, "Details");
    await expect(page.getByText(/A business has no details link/)).toBeVisible();
    await page.getByRole("button", { name: "Archive this Renter" }).click();
    await expect(page.getByText(/This business still has drivers/)).toBeVisible();

    await openBusiness(page, "Drivers");
    await page
      .getByRole("list", { name: "Current drivers" })
      .getByRole("link", { name: EXISTING_DRIVER.name, exact: true })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: EXISTING_DRIVER.name })).toBeVisible();
    const drivesFor = page.getByRole("region", { name: "Drives for" });
    await expect(drivesFor).toContainText(BUSINESS.tradingName);
    await expect(drivesFor.getByText("Current", { exact: true })).toBeVisible();
    await expectAccessible(page);
    await page
      .getByRole("navigation", { name: "Renter sections" })
      .getByRole("link", { name: "Details", exact: true })
      .click();
    await page.getByRole("button", { name: "Archive this Renter" }).click();
    await expect(page.getByText(/They still drive for a business/)).toBeVisible();
  });

  test("removes a driver with no car, who then shows under Past drivers", async ({ page }) => {
    await openBusiness(page, "Drivers");
    const row = page
      .getByRole("list", { name: "Current drivers" })
      .getByRole("listitem")
      .filter({ hasText: NEW_DRIVER.name });
    await row.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Yes, remove" }).click();
    await expect(page.getByRole("list", { name: "Past drivers" })).toContainText(NEW_DRIVER.name);
    await expect(
      page.getByRole("list", { name: "Current drivers" }).filter({ hasText: NEW_DRIVER.name }),
    ).toHaveCount(0);
  });

  test("downloads everything held about the business", async ({ page }) => {
    await openBusiness(page, "Details");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download everything we hold" }).click();
    expect((await download).suggestedFilename()).toBe("renter-everything-held.zip");
  });

  test("doesn't offer the business on the New rental form yet", async ({ page }) => {
    await page.goto("/rentals/new", { waitUntil: "networkidle" });
    await page.getByRole("combobox", { name: /^Renter/ }).fill("Kestrel");
    await expect(page.getByRole("option", { name: /Kestrel/ })).toHaveCount(0);
  });
});
