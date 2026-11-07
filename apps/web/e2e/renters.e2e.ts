import { FAKE_ADDRESS } from "@fleetapp/e2e/fake-places";
import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { latestEmailTo } from "./test-inbox";

/**
 * A Renter from start to their link: the Operator adds them and sends the
 * details form; the Renter, on their own phone with no account, asks for a
 * code, types it, and finds their home address with the address search.
 */
const RENTER = { name: "Sam Example", phone: "0412345678", email: "sam.e2e@example.test" };
const LINK_PATTERN = /https?:\/\/\S+\/r\/[A-Za-z0-9_-]+/;
const CODE_PATTERN = /\b(\d{6})\b/;

test("adds a Renter, sends the details form, and the Renter opens it", async ({
  page,
  browser,
}) => {
  await page.goto("/renters/new", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /^Full name/ }).fill(RENTER.name);
  const phone = page.getByRole("textbox", { name: /^Phone/ });
  await phone.pressSequentially(RENTER.phone);
  await expect(phone).toHaveValue("0412 345 678");
  await page.getByRole("textbox", { name: /^Email/ }).fill(RENTER.email);
  await page.getByRole("button", { name: "Add Renter" }).click();
  await expect(page.getByRole("heading", { name: RENTER.name })).toBeVisible();
  await expectAccessible(page);

  // Everything held comes as one zip (review A7-8), from the Details tab.
  const tabs = page.getByRole("navigation", { name: "Renter sections" });
  await tabs.getByRole("link", { name: "Details", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download everything we hold" }).click();
  expect((await download).suggestedFilename()).toBe("renter-everything-held.zip");
  // The details form is sent from the Overview.
  await tabs.getByRole("link", { name: "Overview", exact: true }).click();

  await page.getByRole("button", { name: "Send details form" }).click();
  await expect(page.getByRole("button", { name: "Send again" })).toBeVisible();
  const linkEmail = await latestEmailTo(RENTER.email);
  const link = LINK_PATTERN.exec(linkEmail.text)?.[0];
  expect(link).toBeDefined();

  // The Renter's own phone: a fresh browser with no sign-in.
  const renterContext = await browser.newContext({ storageState: undefined });
  const renterPage = await renterContext.newPage();
  await renterPage.goto(link ?? "", { waitUntil: "networkidle" });
  await expectAccessible(renterPage);
  await renterPage.getByRole("button", { name: "Email me a code" }).click();
  await expect(renterPage.getByLabel(/Type the code/)).toBeVisible();
  const codeEmail = await latestEmailTo(RENTER.email);
  const code = CODE_PATTERN.exec(codeEmail.text)?.[1] ?? "";
  await renterPage.getByLabel(/Type the code/).fill(code);

  const home = renterPage.getByRole("combobox", { name: /^Home address/ });
  await expect(home).toBeVisible();
  // Told who sees their details, overseas services included (APP 5 and 8, review G8-2).
  await expect(renterPage.getByRole("region", { name: "Privacy" })).toContainText("Postmark");
  await expectAccessible(renterPage);
  await home.fill("1 Exa");
  await renterPage
    .getByRole("listbox")
    .getByRole("option", { name: new RegExp(FAKE_ADDRESS.mainText) })
    .click();
  await expect(home).toHaveValue(new RegExp(FAKE_ADDRESS.street));
  await renterContext.close();
});
