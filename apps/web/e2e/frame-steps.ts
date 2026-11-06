import type { Page } from "@playwright/test";

/** Signs out the way a User does: Sign out in the account menu at the top right. */
export async function startSignOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
}
