import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { MINIMUM_TOUCH_TARGET_PX, PHONE_VIEWPORT } from "./e2e-settings";
import { startSignOut } from "./frame-steps";

/**
 * The frame round every signed-in page (6 Nov 2026 look): the side menu that
 * stays put, the account menu, and the phone's More menu. Signing out is
 * stood in for, so the shared test login is not actually ended.
 */
const SIGN_OUT_ROUTE = "**/api/auth/sign-out";
/** Short enough that the Settings page scrolls on a computer. */
const SHORT_COMPUTER_SCREEN = { width: 1280, height: 520 };

test.describe("on a computer", () => {
  test("the account menu opens from the keyboard and lists its choices", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const trigger = page.getByRole("button", { name: "Account menu" });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Business details",
      "Settings",
      "Sign out",
    ]);
    await expectAccessible(page);

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("Business details opens that part of Settings", async ({ page }) => {
    await page.goto("/cars", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Business details" }).click();
    await page.waitForURL(/\/settings#business-details$/);
  });

  test("Sign out signs out", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.route(SIGN_OUT_ROUTE, (route) => route.fulfill({ json: { success: true } }));
    await startSignOut(page);
    await page.waitForURL(/\/sign-in/);
  });

  test("the side menu stays in view as the page scrolls", async ({ page }) => {
    await page.setViewportSize(SHORT_COMPUTER_SCREEN);
    await page.goto("/settings", { waitUntil: "networkidle" });
    await page.mouse.wheel(0, 5000);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    const sideMenu = page.getByRole("complementary");
    await expect(sideMenu.getByRole("link", { name: "Home", exact: true })).toBeInViewport();
    // Within a pixel of the top: browsers place it to the half pixel.
    expect(Math.abs((await sideMenu.boundingBox())?.y ?? Infinity)).toBeLessThanOrEqual(1);
  });

  test("Calendar has its own menu item, and Rentals is not current there", async ({ page }) => {
    await page.goto("/rentals/calendar?view=car", { waitUntil: "networkidle" });
    const sideMenu = page.getByRole("complementary").getByRole("navigation", { name: "Main" });
    await expect(sideMenu.getByRole("link")).toHaveText([
      "Home",
      "Rentals",
      "Calendar",
      "Cars",
      "Renters",
      "Settings",
    ]);
    await expect(sideMenu.getByRole("link", { name: "Calendar" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(sideMenu.getByRole("link", { name: "Rentals" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("More reaches Calendar and Settings", async ({ page }) => {
    await page.goto("/cars", { waitUntil: "networkidle" });
    const tabBar = page.getByRole("navigation", { name: "Main" });
    await expect(tabBar.getByRole("link")).toHaveText(["Home", "Rentals", "Cars", "Renters"]);
    const more = tabBar.getByRole("button", { name: "More" });
    expect((await more.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);

    await more.click();
    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["Calendar", "Settings"]);
    await expectAccessible(page);
    await page.getByRole("menuitem", { name: "Calendar" }).click();
    await page.waitForURL(/\/rentals\/calendar$/);

    await more.click();
    await expect(page.getByRole("menuitem", { name: "Calendar" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(tabBar.getByRole("link", { name: "Rentals" })).not.toHaveAttribute("aria-current");
  });

  test("the account button is a fingertip wide", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const box = await page.getByRole("button", { name: "Account menu" }).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);
  });
});
