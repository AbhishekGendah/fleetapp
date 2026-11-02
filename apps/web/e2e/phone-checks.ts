import { expect, type Page } from "@playwright/test";

import { MINIMUM_TOUCH_TARGET_PX } from "./e2e-settings";

/** The page fits the phone's width: nothing makes it scroll sideways. */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const isScrollingSideways = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(isScrollingSideways).toBe(false);
}

/** Each named button is at least a fingertip tall (rule 24). */
export async function expectTappableButtons(page: Page, names: readonly string[]): Promise<void> {
  for (const name of names) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);
  }
}
