import { MILLISECONDS_PER_DAY } from "@fleetapp/core";

import { HANDOVER_PAGES_CACHE } from "../../../service-worker/cache-names";
import { rentalPath } from "../../paths";
import { KEPT_ON_PHONE_DAYS } from "./phone-limits";

/**
 * The checklist pages the service worker keeps on the phone so they open with
 * no signal (src/service-worker). Each one shows a Renter's details, so they
 * are wiped as soon as their checklist ends, here or on another phone.
 */

/** The phone's saved checklist pages; null where this browser keeps none (no signal support). */
async function checklistPagesCache(): Promise<Cache | null> {
  if (typeof caches === "undefined" || !(await caches.has(HANDOVER_PAGES_CACHE))) {
    return null;
  }
  return caches.open(HANDOVER_PAGES_CACHE);
}

/**
 * Wipes a rental's saved checklist pages, except those still under way. A
 * page is saved under its address, with or without the app's own query
 * (a move within the app), so both copies go.
 */
export async function forgetChecklistPages(
  rentalId: string,
  openPagePaths: readonly string[] = [],
): Promise<void> {
  const cache = await checklistPagesCache();
  if (!cache) {
    return;
  }
  const prefix = `${rentalPath(rentalId)}/`;
  const requests = await cache.keys();
  const ended = requests.filter((request) => {
    const path = new URL(request.url).pathname;
    return path.startsWith(prefix) && !openPagePaths.includes(path);
  });
  await Promise.all(ended.map((request) => cache.delete(request)));
}

/** Wipes saved checklist pages older than the week a phone may keep them. */
export async function forgetOldChecklistPages(now: number = Date.now()): Promise<void> {
  const cache = await checklistPagesCache();
  if (!cache) {
    return;
  }
  const cutoff = now - KEPT_ON_PHONE_DAYS * MILLISECONDS_PER_DAY;
  const requests = await cache.keys();
  const old = await Promise.all(
    requests.map(async (request) => {
      const savedAt = Date.parse((await cache.match(request))?.headers.get("date") ?? "");
      // A page with no readable date can't be shown to be recent, so it goes too.
      return Number.isNaN(savedAt) || savedAt < cutoff ? request : null;
    }),
  );
  await Promise.all(
    old.filter((request) => request !== null).map((request) => cache.delete(request)),
  );
}

/** Wipes every saved checklist page, as at sign-out. */
export async function forgetAllChecklistPages(): Promise<void> {
  if (typeof caches !== "undefined") {
    await caches.delete(HANDOVER_PAGES_CACHE);
  }
}
