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
 * Then the car comes back: the same photos beside the handover's, new
 * damage, the Renter not there, the car off to the workshop.
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
/** The return page: the handover's pieces plus the date and time picker (2 Nov 2026), plus about 10%. */
const RETURN_PAGE_BUDGET_KB = 800;
/** A damage record's page: photo sender, outline and claim form (395 KB on 2 Nov 2026), plus about 10%. */
const DAMAGE_PAGE_BUDGET_KB = 435;

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

      // A changed detail not yet saved holds the signing back (review G9-2).
      const odometer = page.getByRole("textbox", { name: /^Odometer/ });
      await odometer.fill("");
      await odometer.pressSequentially("1600");
      await expect(page.getByText(/press Save details before the Renter signs/)).toBeVisible();
      await expect(accept).toHaveCount(0);
      await page.getByRole("button", { name: "Save details" }).click();
      await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

      // The Renter reads what is saved, in the report's own words.
      await expect(
        page.getByText(/I received this car on the date and time I sign, with 1,600 km/),
      ).toBeVisible();
      await accept.click();
      await expect(page.getByText("Ask the Renter to sign in the box.")).toBeVisible();

      // They can type their name instead of drawing (review G9-10).
      await page.getByLabel(/^How .* signs/).selectOption("typed");
      const typedName = page.getByRole("textbox", { name: /full name/ });
      await typedName.fill("Someone Else");
      await accept.click();
      await expect(page.getByText(/type their full name exactly as shown/)).toBeVisible();
      await typedName.fill(RENTER.name);
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
      // Whether the copies really went, from their own record (review G9-9).
      await expect(page.getByText(/^Emailed to the Renter/)).toBeVisible();
      await expectAccessible(page);
    });

    test("takes the car back beside the handover: photos, kilometres, new damage", async ({
      page,
    }) => {
      await openRentalOf(page, PARTIES);
      await page.getByRole("button", { name: "Start return" }).click();
      await expect(page.getByRole("heading", { name: `Return: ${CAR_REGO}` })).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await scriptKilobytes(page)).toBeLessThanOrEqual(RETURN_PAGE_BUDGET_KB);
      await expectNoSidewaysScroll(page);

      // Each photo slot shows the handover's photo of the same name beside it.
      await expect(page.getByAltText("Front at handover", { exact: true })).toBeVisible();
      for (const name of DEFAULT_HANDOVER_PHOTOS) {
        await takePhoto(page, `Take photo: ${name}`);
        await expect(
          page
            .getByRole("listitem")
            .filter({ hasText: name })
            .first()
            .getByText("Saved", { exact: true }),
        ).toBeVisible();
      }
      await expect(page.getByText("At handover: Full.")).toBeVisible();
      await page.getByRole("textbox", { name: /^Odometer/ }).pressSequentially("2100");
      await page.getByLabel(/^Fuel/).selectOption("quarter");
      await page.getByRole("textbox", { name: /^Keys handed over/ }).fill("2");
      await page.getByRole("button", { name: "Save details" }).click();
      await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

      // The handover's damage is greyed and lettered; what is marked now is new.
      await expect(
        page.getByRole("button", { name: /^Already there at handover, A: Scratch on rear bumper/ }),
      ).toBeVisible();
      await page.getByLabel("Or choose where on the car").selectOption("bonnet");
      await page.getByRole("textbox", { name: "What is the damage?" }).fill("Dent on bonnet");
      await page.getByRole("button", { name: "Add damage mark" }).click();
      await expect(page.getByRole("button", { name: "Damage 1: Dent on bonnet" })).toBeVisible();
      await takePhoto(page, "Take photo: damage 1");
      await expect(page.getByAltText("Damage 1 photo")).toBeVisible();
      await expectAccessible(page);
    });

    test("finishes the return with the Renter not there and the car to the workshop", async ({
      page,
    }) => {
      const rentalId = await openRentalOf(page, PARTIES);
      await page.getByRole("link", { name: "Continue return" }).click();
      const finish = page.getByRole("button", { name: "Finish return" });
      await expect(finish).toBeVisible();

      await page.getByRole("checkbox", { name: `${RENTER.name} is here to sign` }).uncheck();
      await expect(page.getByText(/The report will say the Renter was not here/)).toBeVisible();
      await page.getByLabel(/^Where does the car go now/).selectOption("in_service");
      await finish.click();
      await expect(page.getByRole("textbox", { name: /^Reason/ })).toBeFocused();
      await page.getByRole("textbox", { name: /^Reason/ }).fill("New tyres");
      await page.getByLabel(/^Expected back/).fill("2027-12-01");
      await expectAccessible(page);
      await finish.click();

      await expect(page).toHaveURL(new RegExp(`/rentals/${rentalId}$`));
      await expect(page.getByText("Returned", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/^The car came back on /)).toBeVisible();
      await expect(page.getByText("Held until")).toBeVisible();
      const report = page.getByRole("link", { name: "Open return report" });
      const response = await page.request.get((await report.getAttribute("href")) ?? "");
      expect(response.headers()["content-type"]).toBe("application/pdf");
      await expect(page.getByRole("button", { name: "Start return" })).toHaveCount(0);
      await expectAccessible(page);
    });

    test("the return's new damage is a record: its photo, a claim lodged, not repairing", async ({
      page,
    }) => {
      await openRentalOf(page, PARTIES);
      await page.getByRole("link", { name: "Dent on bonnet" }).click();
      await expect(page.getByRole("heading", { name: `Damage · ${CAR_REGO}` })).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await scriptKilobytes(page)).toBeLessThanOrEqual(DAMAGE_PAGE_BUDGET_KB);
      await expectNoSidewaysScroll(page);
      await expect(page.getByText("Marked as new damage at the return.")).toBeVisible();
      await expect(page.getByRole("link", { name: RENTER.name })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Open photo / })).toHaveCount(1);
      await expectAccessible(page);

      await page.getByRole("button", { name: "Add a claim" }).click();
      const claim = page.getByRole("dialog");
      await claim.getByRole("textbox", { name: /^Insurer/ }).fill("Example Insurance");
      await claim.getByLabel(/^Claim status/).selectOption("lodged");
      await claim.getByRole("button", { name: "Save claim" }).click();
      await expect(claim.getByRole("textbox", { name: /^Claim number/ })).toBeFocused();
      await claim.getByRole("textbox", { name: /^Claim number/ }).fill("clm-501");
      await expect(claim.getByRole("textbox", { name: /^Claim number/ })).toHaveValue("CLM-501");
      await claim.getByLabel(/^Lodged on/).fill("2026-11-01");
      await claim.getByRole("textbox", { name: /^Excess/ }).pressSequentially("1500");
      await expect(claim.getByRole("textbox", { name: /^Excess/ })).toHaveValue("$1,500");
      await expectAccessible(page);
      await claim.getByRole("button", { name: "Save claim" }).click();
      await expect(claim).toBeHidden();
      await expect(page.getByText("CLM-501")).toBeVisible();
      await expect(page.getByText("$1,500.00")).toBeVisible();

      await page.getByLabel(/^Status/).selectOption("not_repairing");
      await page.getByRole("button", { name: "Save status" }).click();
      await expect(page.getByRole("textbox", { name: /^Note/ })).toBeFocused();
      await page.getByRole("textbox", { name: /^Note/ }).fill("Cosmetic only");
      await page.getByRole("button", { name: "Save status" }).click();
      await expect(page.getByText("Status saved.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Remove this damage" })).toHaveCount(0);

      await page.goto("/", { waitUntil: "networkidle" });
      await expect(
        page
          .getByRole("region", { name: "Claims under way" })
          .getByRole("link", { name: `${CAR_REGO}: Dent on bonnet` }),
      ).toBeVisible();
    });

    test("records damage found later, confirms who had the car, then removes it", async ({
      page,
    }) => {
      await openRentalOf(page, PARTIES);
      await page.getByRole("link", { name: "Dent on bonnet" }).click();
      await page.getByRole("link", { name: `${CAR_REGO} damage` }).click();
      await page.getByRole("button", { name: "Record damage" }).click();
      const form = page.getByRole("dialog");
      await form.getByRole("textbox", { name: /^What is damaged/ }).fill("Chip in windscreen");
      await form.getByLabel(/^Where on the car/).selectOption("windscreen");
      await expect(form.getByRole("button", { name: "Damage 1: the place marked" })).toBeVisible();
      await expectAccessible(page);
      await form.getByRole("button", { name: "Record damage" }).click();
      await expect(form).toBeHidden();

      await page.getByRole("link", { name: "Chip in windscreen" }).click();
      // The car came back today, so the Renter who had it is suggested, not assumed.
      const confirm = page.getByRole("button", { name: `Yes, it was ${RENTER.name}` });
      await confirm.click();
      await expect(page.getByRole("link", { name: RENTER.name })).toBeVisible();
      await expect(confirm).toHaveCount(0);
      await expectAccessible(page);

      await page.getByRole("button", { name: "Remove this damage" }).click();
      await expect(page.getByRole("button", { name: "Record damage" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Chip in windscreen" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Dent on bonnet" })).toBeVisible();
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
