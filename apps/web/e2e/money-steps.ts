import { expect, type Page } from "@playwright/test";

import { E2E_CRON_SECRET } from "./e2e-settings";
import {
  addCarToBook,
  addRenter,
  fillRental,
  morningInDays,
  rentalIdOnPage,
  type NewRenter,
  type RentalParties,
} from "./rental-steps";
import { recordHandover, recordSignedContract } from "./test-records";

/**
 * A Renter, a car and a rental booked, signed and handed over yesterday,
 * then the daily run (rent charged, then its invoice issued). Gives the
 * rental's id.
 */
export async function rentalOutAndCharged(
  page: Page,
  renter: NewRenter,
  parties: RentalParties,
): Promise<string> {
  await addRenter(page, renter);
  await addCarToBook(page, parties.carRego);
  await fillRental(page, parties, morningInDays(2), morningInDays(30));
  await page.getByRole("button", { name: "Book", exact: true }).click();
  const rentalId = await rentalIdOnPage(page, parties);
  await recordSignedContract(rentalId);
  await recordHandover(rentalId);
  const run = await page.request.get("/api/cron/rent", {
    headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
  });
  expect(run.ok()).toBe(true);
  return rentalId;
}

/** Opens the rental's page and waits for it to be the rental asked for. */
export async function openRentalPage(
  page: Page,
  rentalId: string,
  parties: RentalParties,
): Promise<void> {
  await page.goto(`/rentals/${rentalId}`, { waitUntil: "networkidle" });
  await rentalIdOnPage(page, parties);
}
