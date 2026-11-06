import { expect, test, type Page } from "@playwright/test";

import { MINIMUM_TOUCH_TARGET_PX, PHONE_VIEWPORT } from "./e2e-settings";

/**
 * Each shared piece used the way people use it: by keyboard, as screen
 * readers see it, and at phone width. Written against the pieces as they are
 * before the library swap (docs/plans/library-swap.md), so each swap is
 * proven to keep this behaviour.
 */
const CATALOGUE_PATH = "/components";

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
    await openCatalogue(page);
    await page.getByRole("button", { name: "Add an example" }).click();
    const dialog = page.getByRole("dialog", { name: "An example pop-up" });
    await expect(dialog).toBeVisible();
    const isFocusInside = () =>
      dialog.evaluate((element) => element.contains(document.activeElement));
    // The pop-up moves focus inside as it opens; wait for that before pressing Tab.
    await expect.poll(isFocusInside).toBe(true);

    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Tab");
      // Focus passes an edge guard on its way round, so let it settle.
      await expect.poll(isFocusInside).toBe(true);
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

test.describe("image upload", () => {
  const LARGE_PHOTO = { width: 4000, height: 3000 } as const;
  const MAX_EDGE_PX = 1600;

  test("shrinks a large photo to 1600px on its long edge before sending", async ({ page }) => {
    await openCatalogue(page);
    const picker = page.locator("input#example-image");
    // A real 4000 × 3000 photo, drawn in the browser, chosen through the file box.
    await picker.evaluate(async (input: HTMLInputElement, size) => {
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#3a7";
        context.fillRect(0, 0, size.width, size.height);
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
      );
      const files = new DataTransfer();
      files.items.add(new File([blob ?? new Blob()], "photo.jpg", { type: "image/jpeg" }));
      input.files = files.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, LARGE_PHOTO);

    const preview = page.locator("img[src^='blob:']");
    await expect(preview).toBeVisible();
    const width = await preview.evaluate((image: HTMLImageElement) => image.naturalWidth);
    expect(width).toBe(MAX_EDGE_PX);
  });
});

test.describe("photo viewer", () => {
  test("opens full screen, steps through and closes on Escape", async ({ page }) => {
    await openCatalogue(page);
    await page.getByRole("button", { name: "Open Example 001" }).click();

    const viewer = page.getByRole("dialog");
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText("1 of 2");
    await page.keyboard.press("ArrowRight");
    await expect(viewer).toContainText("2 of 2");
    await expect(viewer.getByRole("link", { name: "Open to save or share" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
  });

  test("fetches only the photo on screen, as each view of a licence is logged", async ({
    page,
  }) => {
    await openCatalogue(page);
    await page.getByRole("button", { name: "Open Example 001" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const viewerImages = page.getByRole("dialog").locator("img");
    await expect(viewerImages).toHaveCount(1);
  });
});

test.describe("formatted boxes", () => {
  test("the ABN box spaces its digits as you type", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByLabel("Formats as you type (ABN)");
    await box.pressSequentially("51824753556");
    await expect(box).toHaveValue("51 824 753 556");
  });

  test("Backspace after a space takes the digit before it", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByLabel("Formats as you type (phone)");
    await box.pressSequentially("0412345");
    await expect(box).toHaveValue("0412 345");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(box).toHaveValue("041");
  });

  test("typing in the middle keeps the cursor where it was", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByLabel("Formats as you type (phone)");
    await box.pressSequentially("041245678");
    // Put the cursor after "0412" and type the missing 3.
    await box.evaluate((input: HTMLInputElement) => input.setSelectionRange(4, 4));
    await page.keyboard.type("3");
    await expect(box).toHaveValue("0412 345 678");
    expect(await box.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(6);
  });

  test("+61 can be typed and becomes the national number", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByLabel("Formats as you type (phone)");
    await box.pressSequentially("+61412345678");
    await expect(box).toHaveValue("0412 345 678");
  });

  test("the money box stops at the largest amount", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByLabel("Formats as you type (dollars)");
    await box.pressSequentially("1234567890123");
    await expect(box).toHaveValue("$12,345,678");
    await box.pressSequentially(".999");
    await expect(box).toHaveValue("$12,345,678.99");
  });
});

test.describe("suggestion box (as for an address)", () => {
  test("a picked suggestion fills the box; anything else stays as typed", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByRole("combobox", { name: "Street address" });
    await box.fill("1 ex");
    const options = page.getByRole("listbox").getByRole("option");
    await expect(options).toHaveCount(2);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(box).toHaveValue("1 Example Street");

    await box.fill("Unit 4, 1 Example Street");
    await page.keyboard.press("Tab");
    await expect(box).toHaveValue("Unit 4, 1 Example Street");
  });
});

test("the make box shows its list when tapped, before typing", async ({ page }) => {
  await openCatalogue(page);
  await page.getByRole("combobox", { name: "Make" }).click();
  await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible();
});

test.describe("date and time picker", () => {
  test("is typed part by part with the keyboard, in Australian order", async ({ page }) => {
    await openCatalogue(page);
    const day = page.getByRole("spinbutton", { name: /day/i }).first();
    await day.focus();
    // Day, month, year, hour, minute, then am/pm: each part moves on once filled.
    await page.keyboard.type("15");
    await page.keyboard.type("01");
    await page.keyboard.type("2027");
    await page.keyboard.type("0230");
    await page.keyboard.type("p");

    await expect(page.getByText("Sent as “2027-01-15T14:30”.")).toBeVisible();
  });

  test("picks a day from the calendar, which closes on Escape", async ({ page }) => {
    await openCatalogue(page);
    const opener = page.getByRole("button", { name: "Choose from a calendar" });
    await opener.click();
    const calendar = page.getByRole("dialog", { name: "Calendar" });
    await expect(calendar).toBeVisible();

    await calendar.getByRole("button", { name: "Thursday 10 December 2026" }).click();
    await expect(page.getByText("Sent as “2026-12-10T09:00”.")).toBeVisible();

    await opener.click();
    await expect(calendar).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(calendar).toBeHidden();
  });

  test("is named by its label and says it is required", async ({ page }) => {
    await openCatalogue(page);
    const picker = page.getByRole("group", { name: "Starts" });
    await expect(picker).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: /day/i }).first()).toHaveAttribute(
      "aria-required",
      "true",
    );
  });
});

test.describe("record picker", () => {
  test("finds a record by part of its second line and picks it with the keyboard", async ({
    page,
  }) => {
    await openCatalogue(page);
    const box = page.getByRole("combobox", { name: "Renter" });
    await box.fill("0498");
    await expect(page.getByRole("option")).toHaveCount(1);

    await page.keyboard.press("Enter");

    await expect(box).toHaveValue("Jo Citizen");
    await expect(page.getByText("Sends “renter-3”.")).toBeVisible();
  });

  test("opens its list when tapped and says when nothing matches", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByRole("combobox", { name: "Renter" });
    await box.click();
    await expect(page.getByRole("option")).toHaveCount(3);

    await box.fill("nobody");
    await expect(page.getByText("No Renter matches that.")).toBeVisible();
  });
});

test.describe("bookings calendar", () => {
  test("shows the month Monday first, each handover and return linking to its rental", async ({
    page,
  }) => {
    await openCatalogue(page);
    const calendar = page.locator(".bookings-calendar");
    await expect(calendar.getByRole("columnheader").first()).toHaveText(/Monday/);
    const handover = calendar.getByRole("link", { name: "10:00 am Handover · Sam · 1ABC234" });
    await expect(handover).toHaveAttribute("href", "#booking-1");
    await expect(calendar.getByRole("link", { name: /Return · Alex · 1XYZ789$/ })).toHaveAttribute(
      "href",
      "#booking-2",
    );
    // A day's number is a link to that day, read out with its date.
    await expect(calendar.getByRole("link", { name: /^Open 8 December 2026/ })).toHaveText("8");
  });
});

test.describe("view switch and week strip", () => {
  test("mark the view showing and today", async ({ page }) => {
    await openCatalogue(page);
    const views = page.getByRole("navigation", { name: "Example views" });
    await expect(views.getByRole("link", { name: "Month" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(views.getByRole("link", { name: "By car" })).not.toHaveAttribute("aria-current");
    const week = page.getByRole("navigation", { name: "Example week" });
    await expect(week.getByRole("link")).toHaveCount(7);
    await expect(week.locator('[aria-current="date"]')).toContainText(/Wed\s*2/);
    await expect(week.getByRole("link", { name: /^Tue\s*1\s*, has bookings$/ })).toBeVisible();
  });

  test.describe("at phone width", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("the view switch uses its phone name", async ({ page }) => {
      await openCatalogue(page);
      const views = page.getByRole("navigation", { name: "Example views" });
      await expect(views.getByRole("link", { name: "Day by day" })).toBeVisible();
    });
  });
});

test.describe("contract editor", () => {
  test("formats with the keyboard and toolbar, and stays a template the server accepts", async ({
    page,
  }) => {
    await openCatalogue(page);
    const editor = page.getByRole("textbox", { name: "Contract text" });
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+b");
    await page.keyboard.type("Late fees");
    await expect(page.getByRole("button", { name: "Bold" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Control+b");
    await page.keyboard.type(" apply.");
    await page.getByRole("button", { name: "Numbered list" }).click();

    await expect(editor.locator("ol strong")).toHaveText("Late fees");
    await expect(page.getByText("The server would accept this.")).toBeVisible();
  });

  test("inserts a field from the menu with the keyboard", async ({ page }) => {
    await openCatalogue(page);
    const editor = page.getByRole("textbox", { name: "Contract text" });
    await editor.click();
    await page.keyboard.press("Control+End");
    const before = await editor.locator("[data-merge-field]").count();

    const menuButton = page.getByRole("button", { name: "Insert field" });
    await menuButton.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Rego" }).focus();
    await page.keyboard.press("Enter");

    await expect(editor.locator("[data-merge-field]")).toHaveCount(before + 1);
    await expect(editor.locator('[data-merge-field="carRego"]').last()).toHaveText("Rego");
    await expect(page.getByText("The server would accept this.")).toBeVisible();
  });

  test("offers no way to add links or pictures", async ({ page }) => {
    await openCatalogue(page);
    const editor = page.getByRole("textbox", { name: "Contract text" });
    await editor.click();
    // Pasted HTML with a link and a picture keeps only the text.
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/html", '<p><a href="https://example.test">Click</a><img src="x.png"></p>');
      document.activeElement?.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    // Only real links and pictures count: the editor's own invisible spacers have no source.
    await expect(editor.locator("a[href], img[src]")).toHaveCount(0);
    await expect(editor).toContainText("Click");
    await expect(page.getByText("The server would accept this.")).toBeVisible();
  });
});

test.describe("signature pad", () => {
  test("takes a drawing with a finger at phone width, and clears it", async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    await openCatalogue(page);
    const pad = page.getByRole("img", { name: "Signature" });
    await pad.scrollIntoViewIfNeeded();
    const box = (await pad.boundingBox())!;
    const clear = page.getByRole("button", { name: "Clear signature" });
    await expect(clear).toBeDisabled();

    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 30, { steps: 8 });
    await page.mouse.move(box.x + box.width - 20, box.y + box.height - 30, { steps: 8 });
    await page.mouse.up();

    const drawing = page.locator('input[name="drawnSignature"]');
    await expect(drawing).toHaveValue(/^data:image\/png;base64,/);
    await expect(page.getByText(/^Drawn: /)).toBeVisible();
    expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);
    await clear.click();
    await expect(drawing).toHaveValue("");
    await expect(page.getByText("Nothing drawn yet.")).toBeVisible();
  });
});

test.describe("contract reader", () => {
  test("shows the filled contract as page text, in full", async ({ page }) => {
    await openCatalogue(page);
    const contract = page.getByRole("article", { name: "Example contract" });

    await expect(contract.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(contract).toContainText("Renter's full name");
    await expect(contract).not.toContainText("not on file");
    await expect(contract.getByText("End of contract")).toBeVisible();
  });
});

test.describe("car outline", () => {
  test("marks damage by tapping, or by choosing the area with the keyboard", async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    await openCatalogue(page);
    const outline = page.getByRole("img", { name: /^Car outline/ });
    await outline.scrollIntoViewIfNeeded();
    const box = (await outline.boundingBox())!;

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 4);
    await page.getByLabel("Or choose where on the car").selectOption("rear");

    const marks = page.getByRole("button", { name: /^Damage \d/ });
    await expect(marks).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Damage 2: Rear bumper" })).toBeVisible();
    expect((await marks.first().boundingBox())!.height).toBeGreaterThanOrEqual(
      MINIMUM_TOUCH_TARGET_PX,
    );
    await marks.first().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("2 marked, mark-1 chosen.")).toBeVisible();
  });
});

test.describe("menu", () => {
  test("opens from the keyboard, picks with arrows, closes back to its button", async ({
    page,
  }) => {
    await openCatalogue(page);
    const trigger = page.getByRole("button", { name: "Example menu" });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Example details",
      "Example settings",
      "Example action",
    ]);
    await expect(menu.getByRole("menuitem", { name: "Example settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Chosen: Example action")).toBeVisible();
  });
});

test.describe("quick search", () => {
  test("groups results as you type, and opens one from the keyboard", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByRole("combobox", { name: "Example search" });
    await box.focus();
    await page.keyboard.type("j");
    // One letter searches nothing.
    await expect(page.getByRole("listbox")).toBeHidden();

    await page.keyboard.type("am");
    const results = page.getByRole("listbox");
    await expect(results.getByRole("group")).toHaveCount(2);
    await expect(results.getByRole("group", { name: "Renters" })).toBeVisible();
    await expect(results.getByRole("group", { name: "Rentals" })).toBeVisible();
    await expect(results.getByRole("option")).toHaveCount(2);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#example-search-renter$/);
    await expect(box).toHaveValue("");
  });

  test("says when nothing matches, and Escape closes it", async ({ page }) => {
    await openCatalogue(page);
    const box = page.getByRole("combobox", { name: "Example search" });
    await box.focus();
    await page.keyboard.type("zz");
    await expect(page.getByText("No matches for “zz”")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("No matches for “zz”")).toBeHidden();
    await expect(box).toBeFocused();
  });
});

test.describe("whole-row links", () => {
  const ROW_LINK = "Rego due Thu 12 Nov";

  test("on a computer, the row and the names in it are separate links", async ({ page }) => {
    await openCatalogue(page);
    const rowLink = page.getByRole("link", { name: ROW_LINK });
    await expect(page.getByRole("link", { name: "Jamie Park" })).toBeVisible();

    // A click on the row's empty space opens the row's own link.
    const row = page.getByRole("listitem").filter({ has: rowLink });
    await row.scrollIntoViewIfNeeded();
    const box = (await row.boundingBox())!;
    await page.mouse.click(box.x + box.width - 120, box.y + box.height / 2);
    await expect(page).toHaveURL(/#example-row-1ABC234$/);

    await page.getByRole("link", { name: "Jamie Park" }).click();
    await expect(page).toHaveURL(/#example-renter-1ABC234$/);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("names are plain words, so a tap anywhere opens the row", async ({ page }) => {
      await openCatalogue(page);
      await expect(page.getByRole("link", { name: "Jamie Park" })).toHaveCount(0);
      const name = page.getByText("Jamie Park", { exact: true }).locator("visible=true");
      // Tapped where the name shows: the row's own link is on top there.
      await name.scrollIntoViewIfNeeded();
      const box = (await name.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page).toHaveURL(/#example-row-1ABC234$/);
    });
  });
});

test.describe("navy strip", () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test("fits a phone, with full-width buttons a fingertip tall", async ({ page }) => {
    await openCatalogue(page);
    const strip = page.getByRole("region", { name: "2XYZ789 · Riley Chen" });
    await expect(strip.getByRole("link", { name: "Back to Rentals" })).toBeVisible();
    const main = strip.getByRole("link", { name: "Start return" });
    const swap = strip.getByRole("button", { name: "Swap car" });
    const [mainBox, swapBox] = [(await main.boundingBox())!, (await swap.boundingBox())!];
    expect(mainBox.width).toBeCloseTo(swapBox.width, 0);
    expect(mainBox.height).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_PX);
  });
});
