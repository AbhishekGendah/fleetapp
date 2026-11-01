import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { expect, type Page } from "@playwright/test";

const TOTP_DIGITS = 6;

/** What an authenticator app shows for a key typed in by hand. */
export async function authenticatorCode(manualKey: string): Promise<string> {
  const secret = new TextDecoder().decode(base32.decode(manualKey));
  return createOTP(secret, { digits: TOTP_DIGITS }).totp();
}

/**
 * The authenticator set-up both apps share, after the password: confirm it,
 * read the key by hand, type its code, tick that the recovery codes are
 * saved. Returns the key, for signing in again later.
 */
export async function setUpAuthenticator(page: Page, password: string): Promise<string> {
  await page.getByRole("textbox", { name: "Confirm your password" }).fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  const manualKey = (await page.locator("span.font-mono").first().textContent()) ?? "";
  expect(manualKey).not.toBe("");
  await page.getByLabel(/digit code it shows/).fill(await authenticatorCode(manualKey));
  await page.getByLabel("I have saved these somewhere safe.").check();
  await page.getByRole("button", { name: "Done" }).click();
  return manualKey;
}

/** Keeps the signed-in browser and the authenticator key for the tests that follow. */
export async function saveSignedIn(
  page: Page,
  paths: { state: string; key: string },
  manualKey: string,
): Promise<void> {
  await mkdir(dirname(paths.state), { recursive: true });
  await writeFile(paths.key, manualKey);
  await page.context().storageState({ path: paths.state });
}
