import type { Page } from "@playwright/test";

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
