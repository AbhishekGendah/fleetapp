import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import {
  addCarToBook,
  fillRental,
  openRentalOf,
  typeMoment,
  type RentalParties,
  type TypedMoment,
} from "./rental-steps";
import { openSigningOnPhone, startTemplate } from "./signing-steps";
import { latestEmailTo } from "./test-inbox";
import { markRentalOut, recordSignedContract } from "./test-records";

/**
 * Changes of terms during a rental: the end moved, the rental made ongoing
 * and given an end again, then a new weekly rate sent to the Renter, signed
 * on their phone, and only then in effect.
 */
const RENTER = { name: "Chris Changes", email: "chris.changes@example.test" };
const CAR_REGO = "E2E701";
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: CAR_REGO };
const TEMPLATE_NAME = "Short change form";
const LINK_PATTERN = /https?:\/\/\S+\/r\/[A-Za-z0-9_-]+/;
/**
 * The rental page's JavaScript, compressed: its cards and the change forms,
 * with the date and time picker (435 KB on 2 Nov 2026), plus about 10%.
 * Its address holds the rental's id, so it is checked here.
 */
const RENTAL_PAGE_BUDGET_KB = 480;

const SEPTEMBER_6: TypedMoment = {
  day: "06",
  month: "09",
  year: "2027",
  hour: "09",
  minute: "00",
  meridiem: "a",
};
const OCTOBER_4 = { ...SEPTEMBER_6, day: "04", month: "10" };
const OCTOBER_18 = { ...SEPTEMBER_6, day: "18", month: "10" };

async function openChangeDialog(page: Page, button: string): Promise<void> {
  await page.getByRole("button", { name: button }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test.describe.serial("changing a rental's terms", () => {
  test("sets up a Renter with an email, a car and a booking", async ({ page }) => {
    await page.goto("/renters/new", { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: /^Full name/ }).fill(RENTER.name);
    await page.getByRole("textbox", { name: /^Phone/ }).pressSequentially("0412000701");
    await page.getByRole("textbox", { name: /^Email/ }).fill(RENTER.email);
    await page.getByRole("button", { name: "Add Renter" }).click();
    await expect(page.getByRole("heading", { name: RENTER.name })).toBeVisible();
    await addCarToBook(page, CAR_REGO);
    await fillRental(page, PARTIES, SEPTEMBER_6, OCTOBER_4);
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.getByRole("heading", { name: `${CAR_REGO} · ${RENTER.name}` })).toBeVisible();
  });

  test.describe("on the Operator's phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("moves the end, makes it ongoing, then gives it an end again", async ({ page }) => {
      await openRentalOf(page, PARTIES);
      await expect(page.getByRole("heading", { name: "Changes", exact: true })).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await scriptKilobytes(page)).toBeLessThanOrEqual(RENTAL_PAGE_BUDGET_KB);
      await expectNoSidewaysScroll(page);

      await openChangeDialog(page, "Change end date");
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Save new end" }).click();
      await expect(dialog.getByRole("textbox", { name: /^Reason/ })).toBeFocused();
      await typeMoment(page, /^New end/, OCTOBER_18);
      await dialog
        .getByRole("textbox", { name: /^Reason/ })
        .fill("Renter asked for two more weeks");
      await expectAccessible(page);
      await dialog.getByRole("button", { name: "Save new end" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(/^End date: Ends 18 Oct 2027/)).toBeVisible();

      await openChangeDialog(page, "Make it ongoing");
      await page
        .getByRole("dialog")
        .getByRole("textbox", { name: /^Reason/ })
        .fill("Open-ended now");
      await page.getByRole("dialog").getByRole("button", { name: "Make it ongoing" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(page.getByText(/^Made ongoing: Ongoing \(was ending 18 Oct 2027/)).toBeVisible();

      await openChangeDialog(page, "Set an end date");
      await expect(page.getByText(/Your terms ask for 7 days' notice/)).toBeVisible();
      await typeMoment(page, /^New end/, OCTOBER_4);
      await page
        .getByRole("dialog")
        .getByRole("textbox", { name: /^Reason/ })
        .fill("Notice given");
      await page.getByRole("dialog").getByRole("button", { name: "Save new end" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(page.getByText(/^End date: Ends 4 Oct 2027/)).toBeVisible();
      await expectAccessible(page);
    });
  });

  test("writes a short change-of-terms form", async ({ page }) => {
    await startTemplate(page, { name: TEMPLATE_NAME, kind: "change_of_terms" });
    await page.keyboard.type("Change for ");
    await page.getByRole("button", { name: "Insert field" }).click();
    await page.getByRole("menuitem", { name: "Renter's full name" }).click();
    await page.keyboard.type(": ");
    await page.getByRole("button", { name: "Insert field" }).click();
    await page.getByRole("menuitem", { name: "What is changing" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/^Saved as a new version/)).toBeVisible();
  });

  test.describe("a new weekly rate", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("is sent to sign, and waits", async ({ page }) => {
      const rentalId = await openRentalOf(page, PARTIES);
      await recordSignedContract(rentalId);
      await markRentalOut(rentalId);
      await page.reload({ waitUntil: "networkidle" });

      await openChangeDialog(page, "Change weekly rate");
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox", { name: /^New weekly rate/ }).pressSequentially("380");
      await expect(dialog.getByRole("textbox", { name: /^New weekly rate/ })).toHaveValue("$380");
      await dialog.getByRole("textbox", { name: /^Reason/ }).fill("Yearly review");
      await expectAccessible(page);
      await dialog.getByRole("button", { name: "Send to sign" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(/^Weekly rate: \$380\.00 a week from/)).toBeVisible();
      await expect(page.getByText("Waiting for signature")).toBeVisible();
      await expect(page.getByRole("button", { name: "Withdraw" })).toBeVisible();
    });

    test("the Renter signs it on their phone, and it takes effect", async ({ browser, page }) => {
      const email = await latestEmailTo(RENTER.email);
      expect(email.subject).toMatch(/^A change to your rental from /);
      const phone = await openSigningOnPhone(browser, LINK_PATTERN.exec(email.text)?.[0] ?? "", {
        email: RENTER.email,
        pageTitle: "A change to your rental",
      });
      const form = phone.getByRole("article", { name: "The change of terms" });
      await expect(form).toContainText(
        `Change for ${RENTER.name}: The weekly rate becomes $380.00`,
      );
      await expectAccessible(phone);

      await phone.getByLabel(/^How do you want to sign/).selectOption("typed");
      await phone.getByRole("textbox", { name: /^Your full name/ }).fill(RENTER.name);
      await phone.getByRole("checkbox", { name: /My details above are right/ }).check();
      await phone
        .getByRole("checkbox", { name: /I agree to sign this contract electronically/ })
        .check();
      await phone.getByRole("button", { name: "Sign the change of terms" }).click();
      await expect(phone.getByText("Signed. Thank you.")).toBeVisible();
      expect((await latestEmailTo(RENTER.email)).subject).toMatch(
        /^Your signed change of terms with /,
      );
      await phone.context().close();

      await openRentalOf(page, PARTIES);
      await expect(page.getByText("In effect").first()).toBeVisible();
      const open = page.getByRole("link", { name: "Open signed form" });
      const response = await page.request.get((await open.getAttribute("href")) ?? "");
      expect(response.headers()["content-type"]).toBe("application/pdf");
      await expect(page.getByRole("button", { name: "Withdraw" })).toHaveCount(0);
    });
  });
});
