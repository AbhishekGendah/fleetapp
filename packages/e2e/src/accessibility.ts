import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** The standard the app is held to: WCAG 2.2 at level AA (and the levels below). */
const WCAG_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Runs axe-core, the standard accessibility checker, over the page as it is
 * now and fails on any problem, naming each rule and where it was found.
 */
export async function expectAccessible(page: Page): Promise<void> {
  // A page's tab name can arrive just after its content (streamed metadata); checking
  // before it would fail "document-title" on a page that is fine.
  await expect.poll(() => page.title()).not.toBe("");
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
  const problems = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? "unrated"}): ${violation.help} — ${violation.nodes
        .map((node) => node.target.join(" "))
        .join(", ")}`,
  );
  expect(problems, `Accessibility problems on ${page.url()}`).toEqual([]);
}

/**
 * One accessibility test per page, on a computer and at phone width, and for
 * pages seen signed out, with no sign-in. Both apps list their pages and call this.
 */
export function describePageChecks(options: {
  signedInPages: readonly string[];
  signedOutPages: readonly string[];
  phoneViewport: { width: number; height: number };
}): void {
  const checkEach = (paths: readonly string[]): void => {
    for (const path of paths) {
      test(`${path} has no accessibility problems`, async ({ page }) => {
        await page.goto(path, { waitUntil: "networkidle" });
        await expectAccessible(page);
      });
    }
  };

  checkEach(options.signedInPages);
  test.describe("at phone width", () => {
    test.use({ viewport: options.phoneViewport });
    checkEach(options.signedInPages);
  });
  test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    checkEach(options.signedOutPages);
  });
}
