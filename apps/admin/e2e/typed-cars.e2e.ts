import { expect, test } from "@playwright/test";

import { E2E_TYPED_CARS, PHONE_VIEWPORT } from "./e2e-settings";

const TYPED_CARS_PATH = "/car-models/typed-by-operators";

test.use({ viewport: PHONE_VIEWPORT });

/** Cars Operators typed that are not in the list: seen, then fixed all at once (decision 13). */
test("fixes every car typed the same wrong way, from the keyboard at phone width", async ({
  page,
}) => {
  await page.goto(TYPED_CARS_PATH, { waitUntil: "networkidle" });
  const typedName = `${E2E_TYPED_CARS.make} ${E2E_TYPED_CARS.model}`;
  await expect(page.getByText(typedName)).toHaveCount(E2E_TYPED_CARS.regos.length);
  await expect(page.getByText(E2E_TYPED_CARS.operatorLegalName).first()).toBeVisible();

  const make = page.getByRole("combobox", { name: "Make" }).first();
  await make.fill("Toyota");
  await page.keyboard.press("Tab");
  const model = page.getByRole("combobox", { name: "Model" }).first();
  await model.fill("Corolla");
  await page.keyboard.press("Tab");
  const fixAll = page
    .getByRole("button", { name: `Fix all ${E2E_TYPED_CARS.regos.length} cars typed this way` })
    .first();
  await fixAll.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByText("Nothing to review: every car is in the list.")).toBeVisible();
});
