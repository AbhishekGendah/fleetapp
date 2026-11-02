import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { scriptKilobytes } from "@fleetapp/e2e/download-size";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { MINIMUM_TOUCH_TARGET_PX, PHONE_VIEWPORT } from "./e2e-settings";
import { addCarToBook, fillRental, type RentalParties, type TypedMoment } from "./rental-steps";
import { expectNoSidewaysScroll } from "./phone-checks";
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
const CODE_PATTERN = /\b(\d{6})\b/;
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

async function openRental(page: Page): Promise<void> {
  await page.goto("/rentals", { waitUntil: "networkidle" });
  await page
    .getByRole("link", { name: new RegExp(RENTER.name) })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: `${CAR_REGO} · ${RENTER.name}` })).toBeVisible();
}

/** The Renter's own phone: a fresh browser with no sign-in, past the emailed code. */
async function openOnRenterPhone(browser: Browser, link: string): Promise<Page> {
  const context = await browser.newContext({ storageState: undefined, viewport: PHONE_VIEWPORT });
  const phone = await context.newPage();
  await phone.goto(link, { waitUntil: "networkidle" });
  await expect(phone.getByText("Your rental contract")).toBeVisible();
  await phone.getByRole("button", { name: "Email me a code" }).click();
  await expect(phone.getByLabel(/Type the code/)).toBeVisible();
  const code = CODE_PATTERN.exec((await latestEmailTo(RENTER.email)).text)?.[1] ?? "";
  await phone.getByLabel(/Type the code/).fill(code);
  await expect(phone.getByRole("group", { name: "1. Check your details" })).toBeVisible();
  await phone.waitForLoadState("networkidle");
  return phone;
}

async function drawSignature(phone: Page): Promise<void> {
  const pad = phone.getByRole("img", { name: /^Your signature/ });
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await phone.mouse.move(box.x + 20, box.y + box.height / 2);
  await phone.mouse.down();
  await phone.mouse.move(box.x + box.width / 2, box.y + 30, { steps: 8 });
  await phone.mouse.move(box.x + box.width - 20, box.y + box.height - 30, { steps: 8 });
  await phone.mouse.up();
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
    await page.goto("/settings/contracts", { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: /^Name/ }).fill(TEMPLATE_NAME);
    await page.getByRole("button", { name: "Add template" }).click();
    await expect(page.getByRole("heading", { name: TEMPLATE_NAME })).toBeVisible();
    const editor = page.getByRole("textbox", { name: /^Contract text/ });
    await editor.click();
    await page.keyboard.press("Control+a");
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
    await openRental(page);
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
    const copy = await latestEmailTo(RENTER.email);
    expect(copy.subject).toMatch(/^Your signed rental contract with /);
    expect(copy.attachmentNames).toEqual([expect.stringMatching(/^Rental contract .*\.pdf$/)]);

    // Signing uses the link up: it can never be used again.
    await phone.reload({ waitUntil: "networkidle" });
    await expect(phone.getByText("This link no longer works")).toBeVisible();
    await phone.context().close();
  });

  test("the rental shows the contract signed, and opens the signed PDF", async ({ page }) => {
    await openRental(page);

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
