import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";

/**
 * What the sign-in screen says when a step doesn't go through (review A10-6,
 * and the batch 3 review). The login system's answers are stood in for, so
 * each one can be shown on demand without locking a real login.
 */
test.use({ storageState: { cookies: [], origins: [] }, viewport: PHONE_VIEWPORT });

const MADE_UP_EMAIL = "nobody@example.test";
const MADE_UP_PASSWORD = "a-made-up-password-for-this-test";
const TOO_MANY_REQUESTS = 429;
const UNAUTHORIZED = 401;

async function reachCodeStep(page: Page): Promise<void> {
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({ json: { twoFactorRedirect: true } }),
  );
  await page.goto("/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /Email address/ }).fill(MADE_UP_EMAIL);
  await page.getByLabel(/^Password/).fill(MADE_UP_PASSWORD);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/code from your authenticator app/)).toBeVisible();
}

function answerCodeWith(page: Page, status: number, code: string): Promise<void> {
  return page.route("**/api/auth/two-factor/verify-totp", (route) =>
    route.fulfill({ status, json: { code, message: code } }),
  );
}

test("says the connection dropped, rather than staying on Signing in", async ({ page }) => {
  await page.route("**/api/auth/sign-in/email", (route) => route.abort("internetdisconnected"));
  await page.goto("/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /Email address/ }).fill(MADE_UP_EMAIL);
  await page.getByLabel(/^Password/).fill(MADE_UP_PASSWORD);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Couldn't reach us/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("shows the lock after too many wrong codes, not 'too many tries'", async ({ page }) => {
  await reachCodeStep(page);
  await answerCodeWith(page, TOO_MANY_REQUESTS, "ACCOUNT_TEMPORARILY_LOCKED");
  await page.keyboard.type("123456");
  await expect(page.getByText(/locked for 15 minutes/)).toBeVisible();
});

test("goes back to the password once the sign-in has run out of time", async ({ page }) => {
  await reachCodeStep(page);
  await answerCodeWith(page, UNAUTHORIZED, "INVALID_TWO_FACTOR_COOKIE");
  await page.keyboard.type("123456");
  await expect(page.getByText(/ran out of time/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Email address/ })).toBeVisible();
});
