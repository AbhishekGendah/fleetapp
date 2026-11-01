import { expect, test } from "@playwright/test";

/** The forgot-password form checks the address like every form, and always gives the same answer. */
test.use({ storageState: { cookies: [], origins: [] } });

test("checks the address, then always says the same thing", async ({ page }) => {
  await page.goto("/forgot-password", { waitUntil: "networkidle" });
  const email = page.getByRole("textbox", { name: /Email address/ });
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");

  await email.fill("nobody@example.test");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText(/If that address has a login/)).toBeVisible();
});
