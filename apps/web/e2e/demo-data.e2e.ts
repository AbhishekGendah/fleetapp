import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { MINIMUM_TOUCH_TARGET_PX, PHONE_VIEWPORT } from "./e2e-settings";
import { expectNoSidewaysScroll, expectTappableButtons } from "./phone-checks";

/** The whole run: every car, Renter, rental and handover, against the local stand-ins. */
const WHOLE_RUN_MS = 240_000;
const ADD_BUTTON = "Add demo data";
const SHOWN_ON_DASHBOARD = 5;
/** The demo always has something red: its overdue returns at least. */
const RED_LABELS = /^(Overdue|Missing|Expired|Late|Not ready)$/;
/** Clicks this far inside a row's edge land on the row, not its border. */
const EDGE_PX = 4;
const COMPUTER_VIEWPORT = { width: 1280, height: 900 } as const;

/**
 * On a computer: the row's first link (a name or rego) opens its record, and
 * a click on the row away from any name opens the row's own link.
 */
async function expectNameAndRowLinks(
  page: Page,
  row: Locator,
): Promise<{ namePath: string; fixPath: string }> {
  const [nameLink, rowLink] = [row.getByRole("link").nth(0), row.getByRole("link").nth(1)];
  const namePath = (await nameLink.getAttribute("href"))!;
  const fixPath = (await rowLink.getAttribute("href"))!;
  expect(namePath).toMatch(/^\/(renters|cars)\//);
  // Its spoken name keeps its visible words, then says who (WCAG 2.5.3).
  await expect(rowLink).toHaveAccessibleName(
    `${await rowLink.textContent()}, ${await nameLink.textContent()}`,
  );
  const pageUrl = page.url();

  await nameLink.click();
  await expect(page).toHaveURL(new RegExp(`${namePath}$`));
  await page.goto(pageUrl, { waitUntil: "networkidle" });

  // The top right of the row is no name: it opens the row's own link.
  const box = (await row.boundingBox())!;
  await page.mouse.click(box.x + box.width - EDGE_PX, box.y + EDGE_PX);
  await expect(page).toHaveURL(new RegExp(`${fixPath}$`));
  await page.goto(pageUrl, { waitUntil: "networkidle" });
  return { namePath, fixPath };
}

function attentionRows(page: Page): Locator {
  return page
    .getByRole("region", { name: "Needs attention" })
    .getByRole("list", { name: "Most urgent" })
    .getByRole("listitem");
}

/**
 * The test site's demo data button, used on a phone with the keyboard. It
 * adds its records with DEMO regos and made-up names, which no other
 * browser test looks for.
 */
test.describe.serial("demo data", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("Settings links to it on the test site, and it fits a phone", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Demo data" }).click();
    await expect(
      page.getByRole("heading", { name: /^Fill .* with made-up records$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Steps" }).getByRole("listitem").first(),
    ).toHaveText(/Cars 1 to 10\s*Waiting/);
    await expectTappableButtons(page, [ADD_BUTTON]);
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });

  test("adds everything from the keyboard, then pressing again adds nothing", async ({ page }) => {
    test.setTimeout(2 * WHOLE_RUN_MS);
    await page.goto("/settings/demo-data", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: ADD_BUTTON }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText(/^Done\./, { timeout: WHOLE_RUN_MS });
    await expect(page.getByText("Stopped")).toHaveCount(0);
    await expectAccessible(page);

    await page.getByRole("button", { name: ADD_BUTTON }).click();
    await expect(page.getByRole("status")).toHaveText(/^Done\./, { timeout: WHOLE_RUN_MS });
    const steps = page.getByRole("list", { name: "Steps" }).getByRole("listitem");
    await expect(steps.filter({ hasText: "Already there" })).toHaveCount(await steps.count());

    await page.goto("/cars?search=DEMO01", { waitUntil: "networkidle" });
    await expect(page.getByText("DEMO01").first()).toBeVisible();
  });

  test("the dashboard shows the five most urgent, a tap opens each, and its counts open the cars", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const rows = attentionRows(page);
    await expect(rows).toHaveCount(SHOWN_ON_DASHBOARD);
    await expect(rows.first().getByText(RED_LABELS)).toBeVisible();
    await expect(page.getByRole("link", { name: /^See all \d+$/ })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);

    // One tap per row on a phone: the name is plain words, so a tap on it opens the row's own link.
    const rowLink = rows.first().getByRole("link");
    await expect(rowLink).toHaveCount(1);
    const fixPath = await rowLink.getAttribute("href");
    const box = (await rows.first().boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);
    await page.mouse.click(box.x + EDGE_PX, box.y + EDGE_PX * 2);
    await expect(page).toHaveURL(new RegExp(`${fixPath}$`));

    // The Workshop count opens the cars in service or off road.
    await page.goto("/", { waitUntil: "networkidle" });
    const cars = page.getByRole("region", { name: "Your cars" });
    await cars.getByRole("link", { name: /Workshop/ }).click();
    await expect(page).toHaveURL(/\/cars\?status=workshop/);
    await expect(page.getByRole("status")).toHaveText(/^\d+ cars?$/);

    // Focus the Out count and open it: the cars list shows only those, with who has each.
    await page.goto("/", { waitUntil: "networkidle" });
    const out = cars.getByRole("link", { name: /Out$/ });
    await out.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/cars\?status=rented/);
    await page.getByRole("searchbox").fill("DEMO01");
    await page.keyboard.press("Enter");
    // On a phone the card reads "Now: Aisha Rahman, since …".
    await expect(
      page
        .getByText(/Aisha Rahman, since /)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });

  test("the full Needs attention list fits a phone and filters by kind", async ({ page }) => {
    await page.goto("/attention", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Needs attention", level: 1 })).toBeVisible();
    await page.getByLabel("Kind").selectOption({ label: "Late back from a rental" });
    await expect(page).toHaveURL(/kind=overdue_return/);
    await expect(page.getByText("Kind:").filter({ visible: true }).first()).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });

  test.describe("on a computer", () => {
    test.use({ viewport: COMPUTER_VIEWPORT });

    test("a row's name opens its record, and the rest of the row the place to fix it", async ({
      page,
    }) => {
      await page.goto("/", { waitUntil: "networkidle" });
      await expectAccessible(page);
      await expectNameAndRowLinks(page, attentionRows(page).first());

      // A late return: the name opens the Renter, the rest of the row the rental.
      await page.goto("/attention?kind=overdue_return", { waitUntil: "networkidle" });
      const row = page
        .getByRole("table")
        .getByRole("row")
        .filter({ has: page.getByRole("cell") });
      const paths = await expectNameAndRowLinks(page, row.first());
      expect(paths.namePath).toMatch(/^\/renters\//);
      expect(paths.fixPath).toMatch(/^\/rentals\//);
    });

    test("See all opens the full list, whose kind filter shows only that kind", async ({
      page,
    }) => {
      await page.goto("/", { waitUntil: "networkidle" });
      const seeAll = page.getByRole("link", { name: /^See all \d+ that need attention$/ });
      await seeAll.click();
      await expect(page).toHaveURL(/\/attention$/);
      // Other browser tests add to the same business as they run, so only the shape is checked.
      await expect(page.getByRole("status")).toHaveText(/^\d+ things?$/);
      await expect(page.getByRole("table").getByRole("row")).not.toHaveCount(0);
      await expectAccessible(page);

      await page.getByLabel("Kind").selectOption({ label: "Late back from a rental" });
      await expect(page).toHaveURL(/kind=overdue_return/);
      const table = page.getByRole("table");
      await expect(table.getByRole("link", { name: "DEMO14", exact: true }).first()).toBeVisible();
      const kinds = table.getByRole("row").filter({ has: page.getByRole("cell") });
      await expect(kinds.first()).toBeVisible();
      // Read in one go, as the rows are redrawn when the filter applies.
      const kindsShown = () =>
        kinds.evaluateAll((rows) => [...new Set(rows.map((row) => row.children[1]?.textContent))]);
      await expect.poll(kindsShown).toEqual(["Late back from a rental"]);
      await expectAccessible(page);

      // By keyboard: a row's own link opens its rental.
      await kinds
        .first()
        .getByRole("link", { name: /^Due back / })
        .focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/rentals\/[^/]+$/);
    });
  });

  test("with all cars, the calendar shows only pickups and returns", async ({ page }) => {
    await page.goto("/rentals/calendar", { waitUntil: "networkidle" });
    await expect(page.getByRole("link", { name: /Pickup: DEMO17 · / }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /(^|m )DEMO02 · / })).toHaveCount(0);
    await expectAccessible(page);
  });
});
