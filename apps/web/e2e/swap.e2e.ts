import { DEFAULT_HANDOVER_PHOTOS } from "@fleetapp/core";
import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import {
  addCarToBook,
  fillRental,
  openRentalOf,
  type RentalParties,
  type TypedMoment,
} from "./rental-steps";
import { samplePhoto } from "./sample-photo";
import { drawRenterSignature, startTemplate } from "./signing-steps";
import { latestEmailTo } from "./test-inbox";
import { recordHandover, recordSignedContract } from "./test-records";

/**
 * A car swap during a rental, on the Operator's phone: the swap form
 * written, the car handed back checked in, the new car's photos and
 * details, then the Renter signs and the rental moves to the new car with
 * the old one off to the workshop.
 */
const RENTER = { name: "Sam Swap", email: "sam.swap@example.test" };
const OLD_REGO = "E2E801";
const NEW_REGO = "E2E802";
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: OLD_REGO };
/**
 * A swap page's JavaScript, compressed: the handover checklist's pieces
 * (2 Nov 2026), plus about 10%. Its address holds the rental's id, so it
 * is checked here.
 */
const SWAP_PAGE_BUDGET_KB = 730;

const OCTOBER_4: TypedMoment = {
  day: "04",
  month: "10",
  year: "2027",
  hour: "09",
  minute: "00",
  meridiem: "a",
};
const NOVEMBER_1 = { ...OCTOBER_4, day: "01", month: "11" };

async function fillDetails(page: Page, kilometres: string): Promise<void> {
  await page.getByRole("textbox", { name: /^Odometer/ }).pressSequentially(kilometres);
  await page.getByLabel(/^Fuel/).selectOption("full");
  await page.getByRole("textbox", { name: /^Keys handed over/ }).fill("2");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
}

async function checkSwapPage(page: Page, heading: string): Promise<void> {
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await scriptKilobytes(page)).toBeLessThanOrEqual(SWAP_PAGE_BUDGET_KB);
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);
}

test.describe.serial("swapping the Renter's car", () => {
  test("sets up a Renter, two cars, a rental out and a swap form", async ({ page }) => {
    await page.goto("/renters/new", { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: /^Full name/ }).fill(RENTER.name);
    await page.getByRole("textbox", { name: /^Phone/ }).pressSequentially("0412000801");
    await page.getByRole("textbox", { name: /^Email/ }).fill(RENTER.email);
    await page.getByRole("button", { name: "Add Renter" }).click();
    await expect(page.getByRole("heading", { name: RENTER.name })).toBeVisible();
    await addCarToBook(page, OLD_REGO);
    await addCarToBook(page, NEW_REGO);
    await fillRental(page, PARTIES, OCTOBER_4, NOVEMBER_1);
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.getByRole("heading", { name: `${OLD_REGO} · ${RENTER.name}` })).toBeVisible();
    const rentalId = await openRentalOf(page, PARTIES);
    await recordSignedContract(rentalId);
    await recordHandover(rentalId);

    await startTemplate(page, { name: "Short swap form", kind: "swap_form" });
    await page.keyboard.type("Swap for ");
    await page.getByRole("button", { name: "Insert field" }).click();
    await page.getByRole("menuitem", { name: "Renter's full name" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/^Saved as a new version/)).toBeVisible();
  });

  test.describe("on the Operator's phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("starts the swap into an available car and checks the old car in", async ({ page }) => {
      await openRentalOf(page, PARTIES);
      await page.getByRole("button", { name: "Swap car" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Start the swap" }).click();
      await expect(dialog.getByRole("combobox", { name: /^New car/ })).toBeFocused();
      await dialog.getByRole("combobox", { name: /^New car/ }).fill(NEW_REGO);
      await page
        .getByRole("listbox")
        .getByRole("option", { name: new RegExp(NEW_REGO) })
        .click();
      await dialog.getByRole("textbox", { name: /^Reason/ }).fill("Engine light on");
      await expectAccessible(page);
      await dialog.getByRole("button", { name: "Start the swap" }).click();

      await checkSwapPage(page, `Swap, 1 of 2: ${OLD_REGO} back`);
      await expect(page.getByText("At handover: Full.")).toBeVisible();
      await fillDetails(page, "1600");
      await page.getByRole("link", { name: "Check the new car" }).click();
      await checkSwapPage(page, `Swap, 2 of 2: ${NEW_REGO} out`);
    });

    test("the new car's checklist, then the Renter signs and the rental moves", async ({
      page,
    }) => {
      const rentalId = await openRentalOf(page, PARTIES);
      await expect(page.getByText(`Swap under way: ${OLD_REGO} → ${NEW_REGO}.`)).toBeVisible();
      await expect(
        page.getByText(/^A car swap is under way\. Finish or cancel it first/),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Start return" })).toHaveCount(0);
      await page.getByRole("link", { name: "Continue swap" }).click();
      await page.getByRole("link", { name: "Check the new car" }).click();
      for (const name of DEFAULT_HANDOVER_PHOTOS) {
        const row = page
          .getByRole("listitem")
          .filter({ has: page.getByRole("button", { name: `Take photo: ${name}` }) });
        await row.locator('input[type="file"]').setInputFiles(await samplePhoto(page, "photo.jpg"));
        await expect(
          page
            .getByRole("listitem")
            .filter({ hasText: name })
            .first()
            .getByText("Saved", { exact: true }),
        ).toBeVisible();
      }
      await fillDetails(page, "1000");

      const sign = page.getByRole("button", { name: "The Renter signs the swap" });
      // The Renter reads the business's own swap form, and what is found on the car handed back (review G9-1).
      await expect(
        page
          .getByRole("article", { name: "The car swap form" })
          .getByText(`Swap for ${RENTER.name}`),
      ).toBeVisible();
      await expect(page.getByText(`Damage found on ${OLD_REGO}`, { exact: false })).toBeVisible();
      await expect(
        page.getByText(/I received this car on the date and time I sign, with 1,000 km/),
      ).toBeVisible();
      await expect(page.getByText(`Where does ${OLD_REGO}`)).toBeVisible();
      await page.getByLabel(new RegExp(`^Where does ${OLD_REGO}`)).selectOption("in_service");
      await page.getByRole("textbox", { name: /^Reason/ }).fill("Engine light");
      await page.getByLabel(/^Expected back/).fill("2027-12-01");
      await sign.click();
      await expect(page.getByText("Ask the Renter to sign in the box.")).toBeVisible();
      await drawRenterSignature(page);
      await expectAccessible(page);
      await sign.click();

      await expect(page).toHaveURL(new RegExp(`/rentals/${rentalId}$`));
      await expect(
        page.getByRole("heading", { name: `${NEW_REGO} · ${RENTER.name}` }),
      ).toBeVisible();
      await expect(page.getByText(`${OLD_REGO} → ${NEW_REGO}`)).toBeVisible();
      // Each of the swap's three papers opens from the rental page (review G9-5).
      for (const name of [/^Open swap form/, /^Open return report/, /^Open handover report \(/]) {
        const paper = page.getByRole("link", { name });
        const response = await page.request.get((await paper.getAttribute("href")) ?? "");
        expect(response.headers()["content-type"]).toBe("application/pdf");
      }
      expect((await latestEmailTo(RENTER.email)).subject).toMatch(/^Your car /);
      await expect(page.getByRole("button", { name: "Start return" })).toBeVisible();
      await expectAccessible(page);
    });
  });
});
