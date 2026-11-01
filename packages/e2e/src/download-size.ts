import { expect, test, type Page } from "@playwright/test";

const BYTES_PER_KILOBYTE = 1024;

/**
 * The JavaScript a page made the browser download, in kilobytes as sent over
 * the network (compressed), which is what a phone on poor signal waits for.
 */
export async function scriptKilobytes(page: Page): Promise<number> {
  const bytes = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === "script")
      .reduce((total, entry) => total + (entry as PerformanceResourceTiming).encodedBodySize, 0),
  );
  return Math.round(bytes / BYTES_PER_KILOBYTE);
}

/**
 * One test per page: its JavaScript must stay within its budget (compressed
 * kilobytes), so a page cannot quietly grow heavier for phones on poor
 * signal. Raise a budget only on purpose, with the reason in the commit.
 */
export function describeDownloadBudgets(budgets: Readonly<Record<string, number>>): void {
  for (const [path, budgetKilobytes] of Object.entries(budgets)) {
    test(`${path} downloads at most ${budgetKilobytes} KB of JavaScript`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      expect(await scriptKilobytes(page)).toBeLessThanOrEqual(budgetKilobytes);
    });
  }
}
