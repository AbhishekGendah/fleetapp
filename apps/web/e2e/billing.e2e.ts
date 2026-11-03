import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { openRentalPage, rentalOutAndCharged } from "./money-steps";
import { expectNoSidewaysScroll } from "./phone-checks";
import type { RentalParties } from "./rental-steps";

/**
 * A rental's invoices and receipts on the Operator's phone: the first
 * invoice issued by the daily run, a receipt for a payment, a one-off
 * charge invoiced now, a statement, a document emailed again; and
 * Settings → Invoices.
 */
const RENTER = { name: "Ivy Invoice", email: "ivy.invoice@example.test", phone: "0412002002" };
const CAR_REGO = "E2E2002";
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: CAR_REGO };
const INVOICE_TITLE = /^(Tax invoice|Invoice) [A-Z0-9\-/.]*\d+$/;

let rentalId = "";

function openRental(page: Page): Promise<void> {
  return openRentalPage(page, rentalId, PARTIES);
}

function billingCard(page: Page) {
  return page.locator("div").filter({
    has: page.getByRole("heading", { name: "Invoices and receipts", exact: true }),
  });
}

test.describe.serial("invoices and receipts", () => {
  test("sets up a rental handed over yesterday, and the daily run invoices its rent", async ({
    page,
  }) => {
    rentalId = await rentalOutAndCharged(page, RENTER, PARTIES);
  });

  test.describe("on the Operator's phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("lists the invoice, opens its PDF, and shows its number on the rent line", async ({
      page,
    }) => {
      await openRental(page);
      const card = billingCard(page);
      await expect(page.getByRole("heading", { name: "Invoices and receipts" })).toBeVisible();
      const invoice = page
        .getByRole("listitem")
        .filter({ has: page.getByText(INVOICE_TITLE) })
        .first();
      await expect(invoice).toBeVisible();
      const title = (await invoice.getByText(INVOICE_TITLE).first().textContent()) ?? "";
      const numberText = title.split(" ").at(-1) ?? "";
      await expect(page.getByText(`On ${numberText}`).first()).toBeVisible();
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      const href = await invoice.getByRole("link", { name: /^Open/ }).getAttribute("href");
      const opened = await page.request.get(href ?? "");
      expect(opened.ok()).toBe(true);
      expect(opened.headers()["content-type"]).toContain("application/pdf");
      await expect(card.first()).toBeVisible();
    });

    test("a payment gets a receipt, named in the answer", async ({ page }) => {
      await openRental(page);
      await page.getByRole("button", { name: "Record payment" }).click();
      const payment = page.getByRole("dialog");
      await payment.getByRole("textbox", { name: /^Amount/ }).fill("");
      await payment.getByRole("textbox", { name: /^Amount/ }).pressSequentially("40");
      await payment.getByLabel(/^How/).selectOption("cash");
      await payment.getByRole("button", { name: "Record payment" }).click();
      await expect(payment).toBeHidden();
      await expect(
        page
          .getByRole("listitem")
          .filter({ hasText: /^Receipt [A-Z0-9\-/.]*\d+/ })
          .first(),
      ).toBeVisible();
    });

    test("a one-off charge waits for the weekly invoice, or is invoiced now", async ({ page }) => {
      await openRental(page);
      await page.getByRole("button", { name: "Add charge" }).click();
      const charge = page.getByRole("dialog");
      await charge.getByLabel(/^What for/).selectOption({ label: "Cleaning" });
      await charge.getByRole("textbox", { name: /^Amount/ }).pressSequentially("60");
      await charge.getByRole("textbox", { name: /^Description/ }).fill("Vacuumed");
      await charge.getByRole("button", { name: "Add charge" }).click();
      await expect(charge).toBeHidden();
      await expect(
        page.getByText("1 charge is waiting for the next weekly invoice."),
      ).toBeVisible();

      // From the keyboard.
      await page.getByRole("button", { name: "Invoice now" }).focus();
      await page.keyboard.press("Enter");
      // The button goes once nothing is waiting; the new invoice is listed instead.
      await expect(page.getByText("1 charge is waiting for the next weekly invoice.")).toHaveCount(
        0,
      );
      await expect(
        page
          .getByRole("listitem")
          .filter({ has: page.getByText(INVOICE_TITLE) })
          .filter({ hasText: "$60.00" }),
      ).toBeVisible();
    });

    test("makes a statement for the days asked, and emails a document again", async ({ page }) => {
      await openRental(page);
      await page.getByRole("button", { name: "Statement" }).click();
      const statement = page.getByRole("dialog");
      await expect(statement.getByLabel(/^First day/)).not.toHaveValue("");
      await statement.getByLabel(/^Last day/).fill("2000-01-01");
      await statement.getByLabel(/^First day/).focus();
      await expect(
        statement.getByText("The last day must be on or after the first."),
      ).toBeVisible();
      await statement.getByLabel(/^Last day/).fill(new Date().toISOString().slice(0, 10));
      await expectAccessible(page);
      await statement.getByRole("button", { name: "Make statement" }).click();
      await expect(statement).toBeHidden();
      const listed = page
        .getByRole("listitem")
        .filter({ hasText: /^Statement/ })
        .first();
      await expect(listed).toBeVisible();

      await listed.getByRole("button", { name: "Email again" }).click();
      await expect(listed.getByText("Emailed to the Renter.")).toBeVisible();
    });

    test("Settings → Invoices keeps the next number once started, and saves how to pay", async ({
      page,
    }) => {
      await page.goto("/settings", { waitUntil: "networkidle" });
      await page.getByRole("link", { name: "Invoices", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
      // Its download budget is in download-size.e2e.ts, with the other Settings pages.
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);

      const invoices = page.locator("section").filter({ hasText: "Invoices and credit notes" });
      await expect(invoices.getByRole("textbox", { name: /^Next number/ })).toHaveAttribute(
        "readonly",
        "",
      );
      const prefix = invoices.getByRole("textbox", { name: /^Prefix/ });
      await prefix.fill("inv-");
      await expect(prefix).toHaveValue("INV-");
      await invoices.getByRole("button", { name: "Save numbering" }).click();
      await expect(invoices.getByText("Saved. The next one issued uses it.")).toBeVisible();

      const howToPay = page.getByRole("textbox", { name: /^How to pay/ });
      await howToPay.fill("Bank transfer: BSB 000-000, account 12345678. Use your rego.");
      await page.getByRole("button", { name: "Save how to pay" }).click();
      await expect(page.getByText("Saved. Invoices issued from now print it.")).toBeVisible();
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByRole("textbox", { name: /^How to pay/ })).toHaveValue(/BSB 000-000/);
    });
  });
});
