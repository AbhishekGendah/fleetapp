import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { expect, test } from "@playwright/test";

import { authenticatorCode } from "./authenticator";
import { AUTHENTICATOR_KEY_PATH, E2E_ADMIN, SIGNED_IN_STATE_PATH } from "./e2e-settings";

/** The first sign-in, as the first Admin really does it: password, authenticator, recovery codes. */
test("the first Admin signs in and sets up their authenticator", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(E2E_ADMIN.email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("textbox", { name: "Confirm your password" }).fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Continue" }).click();

  const manualKey = (await page.locator("span.font-mono").first().textContent()) ?? "";
  expect(manualKey).not.toBe("");
  await page.getByLabel(/digit code it shows/).fill(await authenticatorCode(manualKey));

  await page.getByLabel("I have saved these somewhere safe.").check();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).not.toHaveURL(/sign-in|set-up-authenticator/);

  await mkdir(dirname(SIGNED_IN_STATE_PATH), { recursive: true });
  await writeFile(AUTHENTICATOR_KEY_PATH, manualKey);
  await page.context().storageState({ path: SIGNED_IN_STATE_PATH });
});
