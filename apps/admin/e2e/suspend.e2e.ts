import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { E2E_OPERATORS, PHONE_VIEWPORT } from "./e2e-settings";

/** An Operator that starts active, so Suspend is offered (launch checklist, review A10-9). */
const ACTIVE_OPERATOR = E2E_OPERATORS.find((operator) => !operator.isSuspended)!.legalName;

test.use({ viewport: PHONE_VIEWPORT });

test("suspends a business only once asked, then reactivates it, at phone width", async ({
  page,
}) => {
  await page.goto("/operators", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: ACTIVE_OPERATOR }).first().click();
  await expect(page.getByRole("heading", { name: ACTIVE_OPERATOR })).toBeVisible();
  await expectAccessible(page);

  // Saying no to the question changes nothing.
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Suspend" }).click();
  await expect(page.getByRole("button", { name: "Suspend" })).toBeVisible();
  await expect(page.getByText("Suspended", { exact: true })).toHaveCount(0);

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Its Users will not be able to sign in");
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Suspend" }).click();
  await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();
  // Said twice: the status badge and the date it was suspended.
  await expect(page.getByText("Suspended", { exact: true })).toHaveCount(2);

  await page.getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByRole("button", { name: "Suspend" })).toBeVisible();
  await expect(page.getByText("Suspended", { exact: true })).toHaveCount(0);
});
