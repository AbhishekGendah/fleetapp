import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import { addRenter } from "./rental-steps";
import { latestEmailTo } from "./test-inbox";

/**
 * Telling a Renter the business added itself how their details are used
 * (APP 5, review A5-10), and the business's privacy policy link (G8-2).
 */
test.use({ viewport: PHONE_VIEWPORT });

const WITH_EMAIL = { name: "Nina Notice", email: "nina.notice@example.test", phone: "0412000701" };
const WITHOUT_EMAIL_NAME = "Nolan Noemail";
const NOTICE_SUBJECT = /looks after your information$/;

test("emails the notice to a Renter added with an email", async ({ page }) => {
  await addRenter(page, WITH_EMAIL);

  await expect(page.getByText(/Give .* the privacy notice/)).toHaveCount(0);
  const notice = await latestEmailTo(WITH_EMAIL.email);
  expect(notice.subject).toMatch(NOTICE_SUBJECT);
  expect(notice.text).toContain("collects your details");
});

test("tells the business to hand over the notice when the Renter has no email", async ({
  page,
}) => {
  await page.goto("/renters/new", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /^Full name/ }).fill(WITHOUT_EMAIL_NAME);
  await page.getByRole("textbox", { name: /^Phone/ }).pressSequentially("0412000702");
  await page.getByRole("button", { name: "Add Renter" }).click();

  const card = page.getByRole("status").filter({ hasText: "the privacy notice" });
  await expect(card).toContainText(`${WITHOUT_EMAIL_NAME} has no email address`);
  await expectAccessible(page);
  await card.getByRole("link", { name: "Open the privacy notice" }).click();
  await expect(page.getByRole("heading", { name: "Privacy notice for Renters" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Privacy" })).toContainText("Postmark");
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);
});

test("checks the business's privacy policy link as it is typed", async ({ page }) => {
  await page.goto("/settings", { waitUntil: "networkidle" });
  const link = page.getByRole("textbox", { name: /^Your privacy policy/ });
  await link.fill("our-website.example");
  await link.press("Tab");
  await expect(page.getByText(/Enter the full web address, starting https/)).toBeVisible();
  await expect(link).toHaveAttribute("aria-invalid", "true");
  await expectAccessible(page);

  // Saving is left out: the shared test business's other details are blank on purpose.
  await link.fill("https://e2e-rentals.example.com.au/privacy");
  await link.press("Tab");
  await expect(page.getByText(/Enter the full web address, starting https/)).toHaveCount(0);
  await expect(link).not.toHaveAttribute("aria-invalid", "true");
});
