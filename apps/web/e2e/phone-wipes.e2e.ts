import { expectAccessible } from "@fleetapp/e2e/accessibility";
import { expect, test, type Page } from "@playwright/test";

import { PHONE_VIEWPORT } from "./e2e-settings";
import { bookedRental } from "./money-steps";
import type { RentalParties } from "./rental-steps";
import { samplePhoto } from "./sample-photo";

/**
 * What a handover phone keeps of a Renter, and when it lets go (reviews
 * A6-4, A2-11): a cancelled checklist is wiped, and signing out wipes every
 * checklist, after warning about photos not yet sent. Signing out is stood
 * in for, so the shared test login is not actually ended.
 */
test.use({ viewport: PHONE_VIEWPORT });

const RENTER = { name: "Pia Phone", email: "pia.phone@example.test", phone: "0412000601" };
const CAR_REGO = "E2E601";
const PARTIES: RentalParties = { renterName: RENTER.name, carRego: CAR_REGO };
const PHONE_DATABASE = "handover-checklists";
const SAVED_PAGES = "handover-pages";

let rentalId = "";
/** Another rental's checklist, under way on the same phone. */
const OTHER_CHECKLIST_PATH = "/rentals/00000000-0000-4000-8000-000000000001/handover";
/** A checklist saved over a week ago, by a phone that never opened it again. */
const OLD_CHECKLIST_PATH = "/rentals/00000000-0000-4000-8000-000000000002/handover";
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

/** Puts a checklist page on the phone as if it had been opened, saved at that time. */
function savePageOnPhone(page: Page, path: string, savedAt: Date): Promise<void> {
  return page.evaluate(
    async ({ cacheName, address, date }) => {
      const cache = await caches.open(cacheName);
      await cache.put(address, new Response("A checklist", { headers: { date } }));
    },
    { cacheName: SAVED_PAGES, address: path, date: savedAt.toUTCString() },
  );
}

/** The addresses of the checklist pages this phone has saved. */
function savedPagePaths(page: Page): Promise<string[]> {
  return page.evaluate(async (cacheName) => {
    if (!(await caches.has(cacheName))) {
      return [];
    }
    const cache = await caches.open(cacheName);
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  }, SAVED_PAGES);
}

/** How many checklists' typing this phone holds; 0 once its database is gone. */
function savedDraftCount(page: Page): Promise<number> {
  return page.evaluate(async (name) => {
    const names = (await indexedDB.databases()).map((database) => database.name);
    if (!names.includes(name)) {
      return 0;
    }
    return new Promise<number>((resolve, reject) => {
      const opening = indexedDB.open(name);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const counting = opening.result.transaction("drafts").objectStore("drafts").count();
        counting.onerror = () => reject(counting.error);
        counting.onsuccess = () => {
          opening.result.close();
          resolve(counting.result);
        };
      };
    });
  }, PHONE_DATABASE);
}

function hasPhoneDatabase(page: Page): Promise<boolean> {
  return page.evaluate(
    async (name) => (await indexedDB.databases()).some((database) => database.name === name),
    PHONE_DATABASE,
  );
}

/** Starts the rental's handover and waits until this phone has saved its page. */
async function startHandoverOnPhone(page: Page): Promise<string> {
  await page.goto(`/rentals/${rentalId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start handover" }).click();
  await expect(page.getByRole("heading", { name: `Handover: ${CAR_REGO}` })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  const handoverPath = new URL(page.url()).pathname;
  await expect.poll(() => savedPagePaths(page)).toContain(handoverPath);
  return handoverPath;
}

/** Cancels the handover: it asks first, and starts on keeping it (review A10-11). */
async function cancelHandover(page: Page): Promise<void> {
  await page.goto(`/rentals/${rentalId}`, { waitUntil: "networkidle" });
  const cancel = page.getByRole("button", { name: "Cancel this handover" });
  await cancel.click();
  const question = page.getByRole("alertdialog", { name: "Cancel this handover?" });
  await expect(question).toBeVisible();
  await expect(question.getByRole("button", { name: "No, keep the handover" })).toBeFocused();
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(question).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Continue handover" })).toBeVisible();

  await cancel.click();
  await question.getByRole("button", { name: "Yes, cancel the handover" }).click();
  await expect(page.getByRole("button", { name: "Start handover" })).toBeVisible();
}

test.describe.serial("what the handover phone keeps", () => {
  test("sets up a booking", async ({ page }) => {
    rentalId = await bookedRental(page, RENTER, PARTIES);
  });

  test("cancelling a checklist wipes it from this phone", async ({ page }) => {
    const handoverPath = await startHandoverOnPhone(page);
    await page.getByRole("textbox", { name: /^Odometer/ }).pressSequentially("1200");
    await expect.poll(() => savedDraftCount(page)).toBe(1);

    await savePageOnPhone(page, OTHER_CHECKLIST_PATH, new Date());

    await cancelHandover(page);
    await expect.poll(() => savedDraftCount(page)).toBe(0);
    await expect.poll(() => savedPagePaths(page)).not.toContain(handoverPath);
    // Only this rental's checklist goes; another one under way stays (review A6-4).
    expect(await savedPagePaths(page)).toContain(OTHER_CHECKLIST_PATH);
  });

  test("opening the app wipes checklists kept over a week", async ({ page }) => {
    await page.goto("/rentals", { waitUntil: "networkidle" });
    await savePageOnPhone(page, OLD_CHECKLIST_PATH, new Date(Date.now() - EIGHT_DAYS_MS));
    await savePageOnPhone(page, OTHER_CHECKLIST_PATH, new Date());

    await page.goto("/cars", { waitUntil: "networkidle" });
    await expect.poll(() => savedPagePaths(page)).not.toContain(OLD_CHECKLIST_PATH);
    expect(await savedPagePaths(page)).toContain(OTHER_CHECKLIST_PATH);
  });

  test("signing out warns about photos not sent, then wipes the phone", async ({ page }) => {
    await startHandoverOnPhone(page);
    // The checklist's own sends are refused, so the photo stays waiting on the phone.
    await page.route(/\/handover$/, (route) =>
      route.request().headers()["next-action"] ? route.abort() : route.fallback(),
    );
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: /^Take photo: Front/ }) });
    await row.locator('input[type="file"]').setInputFiles(await samplePhoto(page, "front.jpg"));
    await expect(page.getByText(/1 waiting to send/)).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    const warning = page.getByRole("alertdialog", { name: "Not sent yet" });
    await expect(warning).toContainText("1 photo or damage mark on this phone hasn't been sent");
    await expectAccessible(page);
    await page.keyboard.press("Escape");
    await expect(warning).toBeHidden();
    await expect(page.getByRole("heading", { name: `Handover: ${CAR_REGO}` })).toBeVisible();

    await page.route("**/api/auth/sign-out", (route) => route.fulfill({ json: { success: true } }));
    await page.getByRole("button", { name: "Sign out" }).click();
    await warning.getByRole("button", { name: "Sign out and lose them" }).click();
    await page.waitForURL(/\/sign-in/);
    expect(await hasPhoneDatabase(page)).toBe(false);
    expect(await savedPagePaths(page)).toEqual([]);

    await page.unrouteAll();
    await cancelHandover(page);
  });
});
