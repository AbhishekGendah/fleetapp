import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";

/**
 * Each shared piece used the way people use it: by keyboard, as screen
 * readers see it, and at phone width. Written against the pieces as they are
 * before the library swap (docs/plans/library-swap.md), so each swap is
 * proven to keep this behaviour.
 */
const CATALOGUE_PATH = "/components";
const MINIMUM_TOUCH_TARGET_PX = 44;

async function openCatalogue(page: Page): Promise<void> {
  // Waits for the page's code to finish loading, so a key pressed before then
  // is not undone when the page takes over the boxes.
  await page.goto(CATALOGUE_PATH, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Components", level: 1 })).toBeVisible();
}

test.describe("pop-up form", () => {
  test("opens with focus inside, closes on Escape and returns focus", async ({ page }) => {
    await openCatalogue(page);
    const trigger = page.getByRole("button", { name: "Add an example" });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "An example pop-up" });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("keeps Tab inside while open", async ({ page }) => {
    // TODO: passes once the pop-up is on Base UI (library swap stage 5).
    test.fail();
    await openCatalogue(page);
    await page.getByRole("button", { name: "Add an example" }).click();
    const dialog = page.getByRole("dialog", { name: "An example pop-up" });
    await expect(dialog).toBeVisible();

    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }
  });
});

test.describe("searchable box", () => {
  test("suggests as you type and picks with the keyboard", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByRole("combobox", { name: "Make" });
    await box.fill("toy");

    const options = page.getByRole("listbox").getByRole("option");
    await expect(options.first()).toBeVisible();
    await expect(box).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(box).toHaveValue("Toyota");
    await expect(page.getByRole("listbox")).toBeHidden();
  });

  test("closes on Escape and keeps what was typed", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByRole("combobox", { name: "Make" });
    await box.fill("not a real make");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(box).toHaveValue("not a real make");
  });

  test("Tab moves on and keeps what was typed", async ({ page }) => {
    // TODO: today Tab picks the first suggestion even when none is highlighted;
    // passes once the box is on Base UI (library swap stage 5).
    test.fail();
    await openCatalogue(page);
    const box = page.getByRole("combobox", { name: "Make" });
    await box.fill("toy");
    await page.keyboard.press("Tab");
    await expect(box).not.toBeFocused();
    await expect(box).toHaveValue("toy");
  });
});

test.describe("code box", () => {
  test("takes digits only, up to its length", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByLabel(/digit code/);
    await box.pressSequentially("12a34 5678");
    await expect(box).toHaveValue("123456");
  });

  test("a pasted whole code replaces what was typed", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByLabel(/digit code/);
    await box.pressSequentially("99");
    await box.evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text", "654 321");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    });
    await expect(box).toHaveValue("654321");
  });
});

test.describe("form pieces", () => {
  test("a required box is marked required and reads its hint", async ({ page }) => {
    // TODO: only boxes wired through useFormFields read their hint today;
    // passes once every field shares one wiring (library swap stage 6).
    test.fail();
    await openCatalogue(page);
    const box = page.getByLabel(/A required box/);
    await expect(box).toHaveAttribute("aria-required", "true");
    await expect(box).toHaveAccessibleDescription(/A hint goes here/);
  });

  test("the tick box toggles with Space", async ({ page }) => {
    await openCatalogue(page);
    const tick = page.getByRole("checkbox", { name: "A tick box" });
    const wasTicked = await tick.isChecked();
    await tick.focus();
    await page.keyboard.press(" ");
    await expect(tick).toBeChecked({ checked: !wasTicked });
    await page.keyboard.press(" ");
    await expect(tick).toBeChecked({ checked: wasTicked });
  });

  test("the money box adds $ and commas as you type", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByLabel("Formats as you type (dollars)");
    await box.pressSequentially("1234567.8");
    await expect(box).toHaveValue("$1,234,567.8");
  });

  test("the phone box formats as you type", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByLabel("Formats as you type (phone)");
    await box.pressSequentially("0412345678");
    await expect(box).toHaveValue("0412 345 678");
  });
});

test.describe("at phone width", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("nothing makes the page scroll sideways", async ({ page }) => {
    await openCatalogue(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("ordinary buttons are big enough to tap", async ({ page }) => {
    await openCatalogue(page);
    const box = await page.getByRole("button", { name: "Add an example" }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);
  });
});
