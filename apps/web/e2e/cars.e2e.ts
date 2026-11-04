import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test } from "@playwright/test";

import { samplePhoto } from "./sample-photo";

/**
 * The car pages as an Operator uses them: adding a car with the searchable
 * make and model boxes and the kilometre box, then adding a photo (shrunk on
 * the device, sent to storage, checked) and opening it full screen.
 */
const CAR = { rego: "E2E001", state: "WA", make: "Toyota", model: "Corolla", year: "2022" };

test("adds a car, then a photo, and opens it full screen", async ({ page }) => {
  await page.goto("/cars/new", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /^Rego/ }).fill(CAR.rego);
  await page.getByLabel(/^State/).selectOption(CAR.state);

  const make = page.getByRole("combobox", { name: /^Make/ });
  await make.fill("toyo");
  await page.getByRole("listbox").getByRole("option", { name: CAR.make }).click();
  await expect(make).toHaveValue(CAR.make);

  const model = page.getByRole("combobox", { name: /^Model/ });
  await model.fill("corol");
  await page.getByRole("listbox").getByRole("option", { name: CAR.model, exact: true }).click();
  await expect(model).toHaveValue(CAR.model);

  await page.getByRole("textbox", { name: /^Year/ }).fill(CAR.year);
  const odometer = page.getByRole("textbox", { name: /^Odometer/ });
  await odometer.pressSequentially("45678");
  await expect(odometer).toHaveValue("45,678");
  const dailyRate = page.getByRole("textbox", { name: /^Daily rate/ });
  await dailyRate.pressSequentially("1250");
  await expect(dailyRate).toHaveValue("$1,250");

  await page.getByRole("button", { name: "Add car" }).click();
  await expect(page.getByRole("heading", { name: CAR.rego })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("link", { name: "Photos" }).click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(await samplePhoto(page, "car.jpg"));
  const opener = page.getByRole("button", { name: /^Open photo/ }).first();
  await expect(opener).toBeVisible();
  await expectAccessible(page);

  await opener.click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toBeVisible();
  await expect(viewer.locator("img")).toHaveCount(1);
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  // A document: the name is checked like every form, then the file is sent.
  await page.getByRole("link", { name: "Documents" }).click();
  await page.getByRole("button", { name: "Add a document" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a document" });
  await dialog.getByRole("button", { name: "Save document" }).click();
  const name = dialog.getByRole("textbox", { name: /^Name/ });
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await name.fill("Pre-purchase inspection");
  await dialog.locator("input[type=file]").setInputFiles({
    name: "inspection.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n%âãÏÓ\n%%EOF\n"),
  });
  await dialog.getByRole("button", { name: "Save document" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Pre-purchase inspection")).toBeVisible();
  await expectAccessible(page);
});
