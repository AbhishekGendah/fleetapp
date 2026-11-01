import { saveSignedIn, setUpAuthenticator } from "@fleetapp/e2e/authenticator";
import { expect, test } from "@playwright/test";

import { AUTHENTICATOR_KEY_PATH, E2E_ADMIN, SIGNED_IN_STATE_PATH } from "./e2e-settings";

/** The first sign-in, as the first Admin really does it: password, authenticator, recovery codes. */
test("the first Admin signs in and sets up their authenticator", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(E2E_ADMIN.email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  const manualKey = await setUpAuthenticator(page, E2E_ADMIN.password);
  await expect(page).not.toHaveURL(/sign-in|set-up-authenticator/);
  await saveSignedIn(page, { state: SIGNED_IN_STATE_PATH, key: AUTHENTICATOR_KEY_PATH }, manualKey);
});
