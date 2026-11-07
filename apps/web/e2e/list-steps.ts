import { expect, type Page } from "@playwright/test";

/** A list's status filters (CountLinks): each in plain words with its count. */
export async function expectFilterCounts(
  page: Page,
  label: string,
  words: readonly string[],
): Promise<void> {
  const filters = page.getByRole("navigation", { name: label });
  for (const word of words) {
    await expect(filters.getByRole("link", { name: new RegExp(`^${word} \\d+$`) })).toBeVisible();
  }
}

/** Opens one of a list's filters and checks the address and that it is now the current one. */
export async function openFilter(
  page: Page,
  label: string,
  word: string,
  address: RegExp,
): Promise<void> {
  const link = page
    .getByRole("navigation", { name: label })
    .getByRole("link", { name: new RegExp(`^${word} \\d+$`) });
  await link.click();
  await expect(page).toHaveURL(address);
  await expect(link).toHaveAttribute("aria-current", "page");
}
