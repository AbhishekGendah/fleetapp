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

/** A Renter, a car and a rental booked from the day after tomorrow for four weeks. Gives its id. */
export async function bookedRental(
  page: Page,
  renter: NewRenter,
  parties: RentalParties,
): Promise<string> {
  await addRenter(page, renter);
  await addCarToBook(page, parties.carRego);
  await fillRental(page, parties, morningInDays(2), morningInDays(30));
  await page.getByRole("button", { name: "Book", exact: true }).click();
  return rentalIdOnPage(page, parties);
}

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
  const rentalId = await bookedRental(page, renter, parties);
  await recordSignedContract(rentalId);
  await recordHandover(rentalId);
  await runNightly(page);
  return rentalId;
}

/** The daily run, as Vercel's scheduler calls it: rent charged or corrected, then documents issued. */
export async function runNightly(page: Page): Promise<void> {
  const run = await page.request.get("/api/cron/rent", {
    headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
  });
  expect(run.ok()).toBe(true);
}

/** A rental page's tabs by their address (`?tab=`); Overview is the plain address. */
export type RentalTabKey = "money" | "papers" | "log";

/** Opens the rental's page (at one of its tabs) and waits for it to be the rental asked for. */
export async function openRentalPage(
  page: Page,
  rentalId: string,
  parties: RentalParties,
  tab?: RentalTabKey,
): Promise<void> {
  await page.goto(`/rentals/${rentalId}${tab ? `?tab=${tab}` : ""}`, { waitUntil: "networkidle" });
  await rentalIdOnPage(page, parties);
}

/** Stripe's stand-in connected for the business, if an earlier test has not done it. */
export async function connectStripe(page: Page): Promise<void> {
  await page.goto("/settings/payments", { waitUntil: "networkidle" });
  const connect = page.getByRole("button", { name: "Connect Stripe" });
  if (await connect.isVisible()) {
    await connect.click();
  }
  await expect(page.getByText("Ready: cards and direct debit on")).toBeVisible();
}
