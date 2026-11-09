import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { bookedRental, connectStripe, openRentalPage } from "./money-steps";
import { expectNoSidewaysScroll } from "./phone-checks";
import type { RentalParties } from "./rental-steps";
import { openLinkOnPhone } from "./signing-steps";

/**
 * A Renter's direct debit and bond through Stripe's page (slice 4),
 * against Stripe's stand-in: the Operator hands the link over on the spot
 * as a code to scan, or by email; the Renter, on their own phone, sets up
 * the direct debit and pays the bond, coming back from "Stripe's page";
 * and the rental shows both.
 */
const RENTER = {
  name: "Penny Payments",
  email: "penny.payments@example.test",
  phone: "0412004004",
};
const CAR_REGO = "E2E4004";
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: CAR_REGO };
const PAGE_TITLE = "Your payments";
/**
 * The Renter's payments page: the link page's own route (as the signing
 * page), with only two buttons; Stripe's page is Stripe's, not ours. Its
 * address holds the link's secret, so it is checked here.
 */
const PAYMENTS_PAGE_BUDGET_KB = 445;

let rentalId = "";
let linkUrl = "";

test.describe.serial("a Renter's direct debit and bond", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("sets up a booked rental for a business taking payments by Stripe", async ({ page }) => {
    await connectStripe(page);
    rentalId = await bookedRental(page, RENTER, PARTIES);
  });

  test("hands the link over on the spot as a code to scan, or by email", async ({ page }) => {
    await openRentalPage(page, rentalId, PARTIES, "money");
    await expect(page.getByText("Not set up", { exact: true })).toBeVisible();
    await expect(page.getByText(/direct debit is not set up/)).toBeVisible();

    // From the keyboard.
    await page.getByRole("button", { name: "Set up on the spot" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("img", { name: "QR code for the Renter's link" })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);

    // A link now exists (the one shown as a code), so the button sends a new one.
    await page.getByRole("button", { name: "Send again" }).click();
    await expect(page.getByText(/^Emailed\./)).toBeVisible();
    // The code shown before stopped working with the new link, so it is gone (review KS-6).
    await expect(page.getByRole("img", { name: "QR code for the Renter's link" })).toHaveCount(0);
    linkUrl = await page.getByRole("textbox", { name: /copy the link/ }).inputValue();
    expect(linkUrl).toMatch(/\/r\/[A-Za-z0-9_-]+$/);
  });

  test("the Renter sets up the direct debit and pays the bond on their phone", async ({
    browser,
  }) => {
    const phone = await openLinkOnPhone(browser, linkUrl, {
      email: RENTER.email,
      pageTitle: PAGE_TITLE,
    });
    await expect(phone.getByRole("heading", { name: "1. Set up your direct debit" })).toBeVisible();
    await expect(phone.getByText(/can see only the last digits/)).toBeVisible();
    // The privacy notice says what goes to Stripe (review G8-2).
    await expect(phone.getByRole("region", { name: "Privacy" })).toContainText(
      "your name and email go to Stripe",
    );
    expect(await scriptKilobytes(phone)).toBeLessThanOrEqual(PAYMENTS_PAGE_BUDGET_KB);
    await expectNoSidewaysScroll(phone);
    await expectAccessible(phone);

    await phone.getByRole("button", { name: "Set up direct debit" }).click();
    await expect(phone.getByRole("heading", { name: "Stand-in for Stripe" })).toBeVisible();
    await phone.getByRole("button", { name: "Accept and set up" }).click();
    await expect(phone.getByText("Your direct debit is set up.")).toBeVisible();
    await expect(phone.getByRole("button", { name: "Change bank account" })).toBeVisible();

    // The same link open twice (say, the email and the QR code): both go to the one Stripe page.
    const otherTab = await phone.context().newPage();
    await otherTab.goto(linkUrl, { waitUntil: "networkidle" });
    await otherTab.getByRole("button", { name: "Pay $500.00 bond" }).click();
    await expect(otherTab.getByRole("heading", { name: "Stand-in for Stripe" })).toBeVisible();

    await phone.getByRole("button", { name: "Pay $500.00 bond" }).click();
    await expect(phone).toHaveURL(otherTab.url());
    await phone.getByRole("button", { name: "Pay by card" }).click();
    await expect(phone.getByText("Your bond of $500.00 is paid.")).toBeVisible();
    await expect(phone.getByRole("button", { name: /^Pay .* bond$/ })).toHaveCount(0);

    await otherTab.reload();
    await expect(otherTab.getByText("This page has already been paid.")).toBeVisible();
    await expectAccessible(phone);
    await phone.context().close();
  });

  test("the rental shows the direct debit set up and the bond paid, and handover is clear", async ({
    page,
  }) => {
    await openRentalPage(page, rentalId, PARTIES, "money");
    await expect(page.getByText("Set up", { exact: true })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Bond · Card" })).toContainText(
      "Paid",
    );
    await expect(page.getByText(/direct debit is not set up/)).toHaveCount(0);
    await expect(page.getByText(/Bond still to receive/)).toHaveCount(0);
  });

  test("a Renter leaving Stripe's page without finishing comes back to their link", async ({
    browser,
  }) => {
    const phone = await openLinkOnPhone(browser, linkUrl, {
      email: RENTER.email,
      pageTitle: PAGE_TITLE,
    });
    await phone.getByRole("button", { name: "Change bank account" }).click();
    await phone.getByRole("button", { name: "Go back without finishing" }).click();
    await expect(phone.getByRole("heading", { name: "1. Direct debit" })).toBeVisible();
    await expect(phone.getByText("Your direct debit is set up.")).toBeVisible();
    await phone.context().close();
  });
});
