import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { FAKE_ADDRESS } from "@fleetapp/e2e/fake-places";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import { samplePhoto } from "./sample-photo";
import { latestEmailTo } from "./test-inbox";

/**
 * A Renter's details from their own phone to the business's record
 * (launch checklist, review A10-9): the Renter fills in and sends the form
 * at phone width; the business sends it back with a note; the Renter fixes
 * it; the business approves.
 */
const RENTER = { name: "Dana Details", email: "dana.details@example.test" };
const LINK_PATTERN = /https?:\/\/\S+\/r\/[A-Za-z0-9_-]+/;
const CODE_PATTERN = /\b(\d{6})\b/;
const SEND_BACK_NOTE = "Please check your licence number.";
const BUSINESS_NAME_PATTERN = /^Send to /;

async function openLinkOnPhone(browser: Browser, link: string): Promise<Page> {
  const context = await browser.newContext({ storageState: undefined, viewport: PHONE_VIEWPORT });
  const renterPage = await context.newPage();
  await renterPage.goto(link, { waitUntil: "networkidle" });
  await renterPage.getByRole("button", { name: "Email me a code" }).click();
  // The box shows once the code email is sent; reading the inbox before then gets the link email.
  await expect(renterPage.getByLabel(/Type the code/)).toBeVisible();
  const codeEmail = await latestEmailTo(RENTER.email);
  await renterPage.getByLabel(/Type the code/).fill(CODE_PATTERN.exec(codeEmail.text)?.[1] ?? "");
  await expect(renterPage.getByRole("button", { name: BUSINESS_NAME_PATTERN })).toBeVisible();
  return renterPage;
}

async function fillPersonalDetails(renterPage: Page): Promise<void> {
  await renterPage.getByRole("textbox", { name: /^Phone/ }).pressSequentially("0412000777");
  await renterPage.getByLabel(/^Date of birth/).fill("1992-06-15");
  await renterPage.getByRole("combobox", { name: /^Home address/ }).fill("1 Exa");
  await renterPage
    .getByRole("listbox")
    .getByRole("option", { name: new RegExp(FAKE_ADDRESS.mainText) })
    .click();
}

/** The licence and its photos: never shown back, so typed again after a send-back (rule 26). */
async function fillLicence(renterPage: Page, licenceNumber: string): Promise<void> {
  await renterPage.getByLabel(/^Issued in/).selectOption("WA");
  await renterPage.getByRole("textbox", { name: /^Licence number/ }).fill(licenceNumber);
  await renterPage.getByLabel(/^Expires/).fill("2031-06-30");
  for (const side of ["Front", "Back"]) {
    const slot = renterPage.getByRole("listitem").filter({ hasText: side });
    await slot
      .locator('input[type="file"]')
      .first()
      .setInputFiles(await samplePhoto(renterPage, `${side}.jpg`));
    await expect(slot.getByText("Added", { exact: true })).toBeVisible();
  }
}

test("a Renter sends their details from their phone; the business sends back, then approves", async ({
  page,
  browser,
}) => {
  await page.goto("/renters/new", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /^Full name/ }).fill(RENTER.name);
  await page.getByRole("textbox", { name: /^Email/ }).fill(RENTER.email);
  await page.getByRole("button", { name: "Add Renter" }).click();
  await expect(page.getByRole("heading", { name: RENTER.name })).toBeVisible();
  const renterUrl = page.url();
  await page.getByRole("button", { name: "Send details form" }).click();
  await expect(page.getByRole("button", { name: "Send again" })).toBeVisible();
  const link = LINK_PATTERN.exec((await latestEmailTo(RENTER.email)).text)?.[0] ?? "";

  const renterPage = await openLinkOnPhone(browser, link);
  await fillPersonalDetails(renterPage);
  await fillLicence(renterPage, "1234567");
  await expectNoSidewaysScroll(renterPage);
  await expectAccessible(renterPage);
  await renterPage.getByRole("button", { name: BUSINESS_NAME_PATTERN }).click();
  await expect(renterPage.getByText(/will check your details\.$/)).toBeVisible();

  await page.goto(renterUrl, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Review what they sent" }).click();
  await expect(page.getByRole("heading", { name: "Review what they sent" })).toBeVisible();
  await expect(page.getByText("1234567")).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Send back" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /^What should they change\?/ }).fill(SEND_BACK_NOTE);
  await dialog.getByRole("button", { name: "Send back" }).click();
  await expect(page.getByRole("heading", { name: RENTER.name })).toBeVisible();

  // The same link, opened again: the note shows, their details are kept, the licence is not shown back.
  await renterPage.goto(link, { waitUntil: "networkidle" });
  await expect(renterPage.getByText(SEND_BACK_NOTE)).toBeVisible();
  await expect(renterPage.getByRole("textbox", { name: /^Phone/ })).toHaveValue("0412 000 777");
  await expect(renterPage.getByRole("textbox", { name: /^Licence number/ })).toHaveValue("");
  await fillLicence(renterPage, "7654321");
  await renterPage.getByRole("button", { name: BUSINESS_NAME_PATTERN }).click();
  await expect(renterPage.getByText(/will check your details\.$/)).toBeVisible();
  await renterPage.context().close();

  await page.goto(renterUrl, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Review what they sent" }).click();
  await expect(page.getByText("7654321")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: RENTER.name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review what they sent" })).toHaveCount(0);
});
