import { DEFAULT_HANDOVER_PHOTOS } from "@fleetapp/core";
import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { FAKE_ADDRESS } from "@fleetapp/e2e/fake-places";
import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll } from "./phone-checks";
import {
  addCarToBook,
  fillRental,
  openRentalOf,
  type RentalParties,
  type TypedMoment,
} from "./rental-steps";
import { samplePhoto } from "./sample-photo";
import { recordSignedContract } from "./test-records";

/**
 * A car handed over on the Operator's phone: a Renter with everything on
 * file and a signed contract, the photo checklist (one photo taken with no
 * signal, sent once it is back), kilometres, fuel and keys, a damage mark,
 * then the Renter signs to accept, with the bond short and a reason given.
 */
const RENTER = { name: "Hana Handover", email: "hana.handover@example.test" };
const CAR_REGO = "E2E501";
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: CAR_REGO };
/**
 * The handover page's JavaScript, compressed: what it downloads today
 * (2 Nov 2026: form checks, signature pad, the phone's database and the
 * service worker's helper) plus about 10%. Its address holds the rental's
 * id, so it is checked here rather than in download-size.e2e.ts.
 */
const HANDOVER_PAGE_BUDGET_KB = 730;

const AUGUST_2: TypedMoment = {
  day: "02",
  month: "08",
  year: "2027",
  hour: "09",
  minute: "00",
  meridiem: "a",
};
const AUGUST_30 = { ...AUGUST_2, day: "30" };

/** A Renter with everything renting needs, entered as an Operator would. */
async function addRenterReadyToRent(page: Page): Promise<void> {
  await page.goto("/renters/new", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /^Full name/ }).fill(RENTER.name);
  await page.getByRole("textbox", { name: /^Phone/ }).pressSequentially("0412000501");
  await page.getByRole("textbox", { name: /^Email/ }).fill(RENTER.email);
  await page.getByLabel(/^Date of birth/).fill("1990-04-02");
  await page.getByRole("combobox", { name: /^Home address/ }).fill("1 Exa");
  await page
    .getByRole("listbox")
    .getByRole("option", { name: new RegExp(FAKE_ADDRESS.mainText) })
    .click();
  await page.getByRole("button", { name: "Add Renter" }).click();
  await expect(page.getByRole("heading", { name: RENTER.name })).toBeVisible();

  await page.getByRole("link", { name: "Licence", exact: true }).first().click();
  await page.getByRole("button", { name: "Add licence" }).click();
  const licence = page.getByRole("dialog");
  await licence.getByLabel(/^Issued in/).selectOption("WA");
  await licence.getByRole("textbox", { name: /^Licence number/ }).fill("7654321");
  // Class C and a full licence are already chosen.
  await licence.getByLabel(/^Expires/).fill("2031-01-31");
  await licence.getByRole("button", { name: "Save licence" }).click();
  await expect(licence).toBeHidden();
  for (const side of ["Front", "Back"]) {
    const slot = page.getByRole("listitem").filter({ hasText: side }).first();
    await slot.locator('input[type="file"]').setInputFiles(await samplePhoto(page, `${side}.jpg`));
    await expect(slot.getByText(/^Added /)).toBeVisible();
  }
}

async function takePhoto(page: Page, buttonName: string): Promise<void> {
  const row = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: buttonName }) });
  await row.locator('input[type="file"]').setInputFiles(await samplePhoto(page, "photo.jpg"));
}

test.describe.serial("handing a car over", () => {
  test("sets up a ready Renter, a car, a booking and a signed contract", async ({ page }) => {
    await addRenterReadyToRent(page);
    await addCarToBook(page, CAR_REGO);
    await fillRental(page, PARTIES, AUGUST_2, AUGUST_30);
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.getByRole("heading", { name: `${CAR_REGO} · ${RENTER.name}` })).toBeVisible();
    await recordSignedContract(await openRentalOf(page, PARTIES));
  });

  test.describe("on the Operator's phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("fills in the checklist, keeping going with no signal", async ({ page, context }) => {
      await openRentalOf(page, PARTIES);
      await page.getByRole("button", { name: "Start handover" }).click();
      await expect(page.getByRole("heading", { name: `Handover: ${CAR_REGO}` })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectAccessible(page);
      expect(await scriptKilobytes(page)).toBeLessThanOrEqual(HANDOVER_PAGE_BUDGET_KB);
      await expectNoSidewaysScroll(page);

      const photos = [...DEFAULT_HANDOVER_PHOTOS];
      for (const name of photos.slice(0, -1)) {
        await takePhoto(page, `Take photo: ${name}`);
        await expect(
          page
            .getByRole("listitem")
            .filter({ hasText: name })
            .first()
            .getByText("Saved", { exact: true }),
        ).toBeVisible();
      }

      // The page is kept on the phone once visited: it opens with no signal.
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload({ waitUntil: "networkidle" });
      await context.setOffline(true);
      await page.reload();
      await expect(page.getByRole("heading", { name: `Handover: ${CAR_REGO}` })).toBeVisible();
      const last = photos.at(-1)!;
      await takePhoto(page, `Take photo: ${last}`);
      await expect(page.getByText(/1 waiting to send/)).toBeVisible();
      await context.setOffline(false);
      await page.getByRole("button", { name: "Send now" }).click();
      await expect(page.getByText(/waiting to send/)).toHaveCount(0);

      await page.getByRole("textbox", { name: /^Odometer/ }).pressSequentially("1500");
      await page.getByLabel(/^Fuel/).selectOption("full");
      await page.getByRole("textbox", { name: /^Keys handed over/ }).fill("2");
      await page.getByRole("button", { name: "Save details" }).click();
      await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

      await page.getByLabel("Or choose where on the car").selectOption("rear");
      await page
        .getByRole("textbox", { name: "What is the damage?" })
        .fill("Scratch on rear bumper");
      await page.getByRole("button", { name: "Add damage mark" }).click();
      await expect(
        page.getByRole("button", { name: "Damage 1: Scratch on rear bumper" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Remove mark 1" })).toBeVisible();
      await takePhoto(page, "Take photo: damage 1");
      await expect(page.getByAltText("Damage 1 photo")).toBeVisible();
    });

    test("the Renter accepts the car, the bond short with a reason", async ({ page }) => {
      const rentalId = await openRentalOf(page, PARTIES);
      await page.getByRole("link", { name: "Continue handover" }).click();
      const accept = page.getByRole("button", { name: "The Renter accepts the car" });
      await expect(accept).toBeVisible();

      await accept.click();
      await expect(page.getByText("Ask the Renter to sign in the box.")).toBeVisible();
      const pad = page.getByRole("img", { name: /signature$/ });
      await pad.scrollIntoViewIfNeeded();
      const box = (await pad.boundingBox())!;
      await page.mouse.move(box.x + 20, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 20, box.y + 30, { steps: 10 });
      await page.mouse.up();
      await page
        .getByRole("textbox", { name: /Why does the car go anyway/ })
        .fill("Bond paid Friday");
      await expectAccessible(page);
      await accept.click();

      await expect(page).toHaveURL(new RegExp(`/rentals/${rentalId}$`));
      await expect(page.getByText("Handed over", { exact: true })).toBeVisible();
      const report = page.getByRole("link", { name: "Open handover report" });
      const response = await page.request.get((await report.getAttribute("href")) ?? "");
      expect(response.headers()["content-type"]).toBe("application/pdf");
      await expect(page.getByRole("button", { name: "Start handover" })).toHaveCount(0);
      await expectAccessible(page);
    });
  });

  test("Settings changes the photo list for rentals made afterwards", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "networkidle" });
    const list = page.getByRole("textbox", { name: /^Photos taken at each handover/ });
    await expect(list).toHaveValue(DEFAULT_HANDOVER_PHOTOS.join("\n"));
    await list.fill("Front\nRear\nFront");
    await page.getByRole("button", { name: "Save photo list" }).click();
    await expect(page.getByText("Each photo can be on the list once.")).toBeVisible();

    await list.fill("Front\nRear\nOdometer");
    await page.getByRole("button", { name: "Save photo list" }).click();
    await expect(page.getByText(/^Saved\. New rentals use this list/)).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await expect(list).toHaveValue("Front\nRear\nOdometer");
    await list.fill(DEFAULT_HANDOVER_PHOTOS.join("\n"));
    await page.getByRole("button", { name: "Save photo list" }).click();
    await expect(page.getByText(/^Saved\. New rentals use this list/)).toBeVisible();
  });
});
