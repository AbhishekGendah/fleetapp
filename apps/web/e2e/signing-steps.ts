import type { ContractTemplateKind } from "@fleetapp/core";
import { expect, type Browser, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { latestEmailTo } from "./test-inbox";

const CODE_PATTERN = /\b(\d{6})\b/;

/**
 * Adds a template of a kind in Settings → Contracts and opens its text with
 * everything selected, ready to type over.
 */
export async function startTemplate(
  page: Page,
  template: { name: string; kind?: ContractTemplateKind },
): Promise<void> {
  await page.goto("/settings/contracts", { waitUntil: "networkidle" });
  if (template.kind) {
    await page.getByLabel(/^Kind/).selectOption(template.kind);
  }
  await page.getByRole("textbox", { name: /^Name/ }).fill(template.name);
  await page.getByRole("button", { name: "Add template" }).click();
  await expect(page.getByRole("heading", { name: template.name })).toBeVisible();
  await page.getByRole("textbox", { name: /^Contract text/ }).click();
  await page.keyboard.press("Control+a");
}

/**
 * The Renter's own phone: a fresh browser with no sign-in, opened on their
 * signing link and past the emailed code, showing their details to check.
 */
export async function openSigningOnPhone(
  browser: Browser,
  link: string,
  renter: { email: string; pageTitle: string },
): Promise<Page> {
  const context = await browser.newContext({ storageState: undefined, viewport: PHONE_VIEWPORT });
  const phone = await context.newPage();
  await phone.goto(link, { waitUntil: "networkidle" });
  await expect(phone.getByText(renter.pageTitle)).toBeVisible();
  await phone.getByRole("button", { name: "Email me a code" }).click();
  await expect(phone.getByLabel(/Type the code/)).toBeVisible();
  const code = CODE_PATTERN.exec((await latestEmailTo(renter.email)).text)?.[1] ?? "";
  await phone.getByLabel(/Type the code/).fill(code);
  await expect(phone.getByRole("group", { name: "1. Check your details" })).toBeVisible();
  await phone.waitForLoadState("networkidle");
  return phone;
}

/** The Renter draws a line across the signature box on the Operator's phone. */
export async function drawRenterSignature(page: Page): Promise<void> {
  const pad = page.getByRole("img", { name: /signature$/ });
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + 30, { steps: 10 });
  await page.mouse.up();
}
