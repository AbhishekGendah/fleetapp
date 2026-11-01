import { expect, test, type Page } from "@playwright/test";

/**
 * Rule 28 on a real form: each box is checked once you leave it, then with
 * every key; nothing shows for a box not reached yet; saving with problems
 * moves to the first one and sends nothing. Nothing is ever created here.
 */
const FORM_PATH = "/operators/new";

async function openForm(page: Page): Promise<void> {
  await page.goto(FORM_PATH, { waitUntil: "networkidle" });
}

const legalName = (page: Page) => page.getByRole("textbox", { name: /Legal business name/ });
const email = (page: Page) => page.getByRole("textbox", { name: /Their email address/ });

test("an untouched form shows no problems", async ({ page }) => {
  await openForm(page);
  await expect(legalName(page)).not.toHaveAttribute("aria-invalid", "true");
  await expect(email(page)).not.toHaveAttribute("aria-invalid", "true");
});

test("a box is checked when left, then again with each key", async ({ page }) => {
  await openForm(page);
  await email(page).fill("not-an-email");
  await expect(email(page)).not.toHaveAttribute("aria-invalid", "true");

  await email(page).blur();
  await expect(email(page)).toHaveAttribute("aria-invalid", "true");
  await expect(email(page)).toHaveAccessibleDescription(/.+/);

  await email(page).fill("sam@example.test");
  await expect(email(page)).not.toHaveAttribute("aria-invalid", "true");
});

test("saving with problems moves to the first one and sends nothing", async ({ page }) => {
  await openForm(page);
  await email(page).fill("sam@example.test");
  await page.getByRole("button", { name: "Create and send invite" }).click();

  await expect(legalName(page)).toBeFocused();
  await expect(legalName(page)).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(new RegExp(`${FORM_PATH}$`));
});
