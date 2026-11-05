import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { MINIMUM_TOUCH_TARGET_PX } from "./e2e-settings";
import {
  addCarToBook,
  fillRental,
  openRentalOf,
  type RentalParties,
  type TypedMoment,
} from "./rental-steps";
import { expectNoSidewaysScroll } from "./phone-checks";
import { openSigningOnPhone, startTemplate } from "./signing-steps";
import { latestEmailTo } from "./test-inbox";

/**
 * A contract signed on the Renter's phone: the Operator writes a short
 * template and sends the booked rental's contract; the Renter types the
 * emailed code, checks their details, reads the contract, agrees and draws
 * their signature; the business then has the signed PDF, and both have a
 * copy by email.
 */
const RENTER = { name: "Sigrid Signer", email: "sigrid.signer@example.test" };
const CAR_REGO = "E2E301";
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: CAR_REGO };
const TEMPLATE_NAME = "Short signing contract";
const LINK_PATTERN = /https?:\/\/\S+\/r\/[A-Za-z0-9_-]+/;
const PDF_START = "%PDF-";
/**
 * The signing page's JavaScript, compressed: what it downloads today
 * (1 Nov 2026, with the form checks and the signature pad) plus about 10%.
 * Its address holds the link's secret, so it is checked here rather than in
 * download-size.e2e.ts.
 */
const SIGNING_PAGE_BUDGET_KB = 445;

const JUNE_7: TypedMoment = {
  day: "07",
  month: "06",
  year: "2027",
  hour: "09",
  minute: "00",
  meridiem: "a",
};
const JULY_5 = { ...JUNE_7, day: "05", month: "07" };

function openOnRenterPhone(browser: Browser, link: string): Promise<Page> {
  return openSigningOnPhone(browser, link, {
    email: RENTER.email,
    pageTitle: "Your rental contract",
  });
}

/** Where the first of two strokes is drawn, as a share of the box: checked once both are down. */
const FIRST_STROKE_AT = { x: 0.25, y: 0.5 };

/**
 * Two strokes, lifting the finger between them, as a real signature is
 * drawn; the first must still be in what is signed (review A10-1).
 */
async function drawSignature(phone: Page): Promise<void> {
  const pad = phone.getByRole("img", { name: /^Your signature/ });
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await phone.mouse.move(box.x + 20, box.y + box.height * FIRST_STROKE_AT.y);
  await phone.mouse.down();
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height * FIRST_STROKE_AT.y, {
    steps: 8,
  });
  await phone.mouse.up();
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height - 30);
  await phone.mouse.down();
  await phone.mouse.move(box.x + box.width - 20, box.y + 30, { steps: 8 });
  await phone.mouse.up();
  expect(await hasInkAt(phone, FIRST_STROKE_AT)).toBe(true);
}

/** Whether the signature sent with the form has ink at a spot (a share of its width and height). */
function hasInkAt(phone: Page, at: { x: number; y: number }): Promise<boolean> {
  return phone.evaluate(async (spot) => {
    const field = document.querySelector<HTMLInputElement>('input[name="drawnSignature"]');
    const image = new Image();
    image.src = field?.value ?? "";
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const alpha = context.getImageData(
      Math.round(image.width * spot.x),
      Math.round(image.height * spot.y),
      1,
      1,
    ).data[3];
    return (alpha ?? 0) > 0;
  }, at);
}

test.describe.serial("signing a contract", () => {
  test("sets up a Renter with an email, a car, a booking and a short contract", async ({
    page,
  }) => {
    await page.goto("/renters/new", { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: /^Full name/ }).fill(RENTER.name);
    await page.getByRole("textbox", { name: /^Phone/ }).pressSequentially("0412000301");
    await page.getByRole("textbox", { name: /^Email/ }).fill(RENTER.email);
    await page.getByRole("button", { name: "Add Renter" }).click();
    await expect(page.getByRole("heading", { name: RENTER.name })).toBeVisible();
    await addCarToBook(page, CAR_REGO);
    await fillRental(page, PARTIES, JUNE_7, JULY_5);
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.getByRole("heading", { name: `${CAR_REGO} · ${RENTER.name}` })).toBeVisible();

    // Only the Renter's name and the car's rego: both on file, so nothing blocks sending.
    await startTemplate(page, { name: TEMPLATE_NAME });
    await page.keyboard.type("Rental agreement for ");
    await page.getByRole("button", { name: "Insert field" }).click();
    await page.getByRole("menuitem", { name: "Renter's full name" }).click();
    await page.keyboard.type(", who rents ");
    await page.getByRole("button", { name: "Insert field" }).click();
    await page.getByRole("menuitem", { name: "Rego" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/^Saved as a new version/)).toBeVisible();
    // The first template is the default already; after the contract tests, this one is made it.
    const makeDefault = page.getByRole("button", { name: "Use for new rentals" });
    if ((await makeDefault.count()) > 0) {
      await makeDefault.click();
    }
    await expect(page.getByText("Used for new rentals").first()).toBeVisible();
  });

  test("the Operator sends the contract, and the rental shows it waiting", async ({ page }) => {
    await openRentalOf(page, PARTIES);
    await page.getByRole("button", { name: "Send for signing" }).click();

    await expect(page.getByText(/^Emailed\. It works until/)).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText(`Sent to ${RENTER.email}`, { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send again" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel link" })).toBeVisible();
    await expectAccessible(page);
  });

  test("the Renter signs on their phone, by drawing, after the checks", async ({ browser }) => {
    const email = await latestEmailTo(RENTER.email);
    expect(email.subject).toMatch(/^Your rental contract from /);
    const phone = await openOnRenterPhone(browser, LINK_PATTERN.exec(email.text)?.[0] ?? "");

    const contract = phone.getByRole("article", { name: "Your rental contract" });
    await expect(contract).toContainText(
      `Rental agreement for ${RENTER.name}, who rents ${CAR_REGO}`,
    );
    await expect(contract.getByText("End of contract")).toBeVisible();
    await expectAccessible(phone);
    expect(await scriptKilobytes(phone)).toBeLessThanOrEqual(SIGNING_PAGE_BUDGET_KB);
    await expectNoSidewaysScroll(phone);

    // A typed name must be the name on the contract: checked as it is typed.
    await phone.getByLabel(/^How do you want to sign/).selectOption("typed");
    const typedName = phone.getByRole("textbox", { name: /^Your full name/ });
    await typedName.fill("Someone Else");
    await typedName.press("Tab");
    await expect(
      phone.getByText("Type your full name exactly as it is on the contract."),
    ).toBeVisible();
    await phone.getByLabel(/^How do you want to sign/).selectOption("drawn");

    // Nothing ticked yet: signing is refused, and the first problem gets the focus.
    const signButton = phone.getByRole("button", { name: "Sign the contract" });
    await signButton.click();
    await expect(phone.getByRole("checkbox", { name: /My details above are right/ })).toBeFocused();

    await phone.getByRole("checkbox", { name: /My details above are right/ }).check();
    await phone
      .getByRole("checkbox", { name: /I agree to sign this contract electronically/ })
      .check();
    await drawSignature(phone);
    expect((await signButton.boundingBox())!.height).toBeGreaterThanOrEqual(
      MINIMUM_TOUCH_TARGET_PX,
    );
    await signButton.click();

    await expect(phone.getByText("Signed. Thank you.")).toBeVisible();
    await expectAccessible(phone);
    const copy = await latestEmailTo(RENTER.email, "Your signed rental contract with ");
    expect(copy.attachmentNames).toEqual([expect.stringMatching(/^Rental contract .*\.pdf$/)]);

    // Signing uses the link up: reopened, it says it is signed (review A3-7).
    const signingUrl = phone.url();
    // The business takes payments by Stripe (its stand-in, connected by the
    // payments test): the Renter carries on to them with no second code.
    await phone.getByRole("button", { name: "Set up your payments" }).click();
    await expect(phone.getByRole("heading", { name: "1. Set up your direct debit" })).toBeVisible();
    await phone.goto(signingUrl, { waitUntil: "networkidle" });
    await expect(phone.getByText("This is already signed")).toBeVisible();
    await phone.context().close();
  });

  test("the rental shows the contract signed, and opens the signed PDF", async ({ page }) => {
    await openRentalOf(page, PARTIES);

    await expect(page.getByText("Contract signed", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send for signing" })).toHaveCount(0);
    const signed = page.getByRole("link", { name: "Open signed contract" });
    const response = await page.request.get((await signed.getAttribute("href")) ?? "");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect((await response.body()).subarray(0, PDF_START.length).toString()).toBe(PDF_START);
    await expectAccessible(page);
  });
});
