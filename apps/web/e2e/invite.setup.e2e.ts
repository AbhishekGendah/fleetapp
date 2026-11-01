import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { saveSignedIn, setUpAuthenticator } from "@fleetapp/e2e/authenticator";
import { expect, test } from "@playwright/test";

import { AUTHENTICATOR_KEY_PATH, E2E_USER, SIGNED_IN_STATE_PATH } from "./e2e-settings";

/** The invited User's first visit, as it really happens: password, authenticator, recovery codes. */
test("the invited User sets a password and their authenticator", async ({ page }) => {
  await page.goto(`/invite/${process.env.E2E_INVITE_TOKEN}`, { waitUntil: "networkidle" });
  await expectAccessible(page);
  await page.getByRole("textbox", { name: /Choose a password/ }).fill(E2E_USER.password);
  await page.getByRole("textbox", { name: /Type it again/ }).fill(E2E_USER.password);
  await page.getByRole("button", { name: /Continue|anyway/ }).click();

  const manualKey = await setUpAuthenticator(page, E2E_USER.password);
  await expect(page).not.toHaveURL(/invite|set-up-authenticator|sign-in/);
  await saveSignedIn(page, { state: SIGNED_IN_STATE_PATH, key: AUTHENTICATOR_KEY_PATH }, manualKey);
});
