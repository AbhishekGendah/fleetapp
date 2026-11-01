import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The standard the app is held to: WCAG 2.2 at level AA (and the levels below). */
const WCAG_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Runs axe-core, the standard accessibility checker, over the page as it is
 * now and fails on any problem, naming each rule and where it was found.
 */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
  const problems = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? "unrated"}): ${violation.help} — ${violation.nodes
        .map((node) => node.target.join(" "))
        .join(", ")}`,
  );
  expect(problems, `Accessibility problems on ${page.url()}`).toEqual([]);
}
