import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { bookedRental } from "./money-steps";
import { expectNoSidewaysScroll } from "./phone-checks";
import { fillRental, morningInDays, type RentalParties } from "./rental-steps";
import { recordHandover, recordLateBack } from "./test-records";

/**
 * A car still out past its return date is not free until it is back
 * (docs/plans/find-a-car.md, decision 5): the New rental form refuses it for
 * any dates, says when it was due back, and links to the late rental. On the
 * Operator's phone.
 */
const RENTER = { name: "Lola Late", email: "lola.late@example.test", phone: "0412009301" };
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: "E2E9301" };
const STILL_OUT =
  /^This car is still out: it was due back .+ and hasn't been returned yet\. Choose another car, or record its return first\.$/;

test.describe.serial("a car still out past its return date", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("sets up a rental out and late back", async ({ page }) => {
    const rentalId = await bookedRental(page, RENTER, PARTIES);
    await recordHandover(rentalId);
    await recordLateBack(rentalId);
  });

  test("refuses booking the car next month, and opens the late rental by keyboard", async ({
    page,
  }) => {
    await fillRental(page, PARTIES, morningInDays(30), morningInDays(37));
    await page.getByRole("button", { name: "Book", exact: true }).click();

    await expect(page.getByText(STILL_OUT)).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);

    await page.getByRole("link", { name: "See that rental" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: `${PARTIES.carRego} · ${RENTER.name}` }),
    ).toBeVisible();
  });
});
