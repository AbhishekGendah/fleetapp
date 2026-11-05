/**
 * What a handover phone may keep, readable without loading the phone
 * database's code, so pages that only tidy up stay small.
 */

/** The longest the phone keeps a handover's details and photos (rule 25 and privacy). */
export const KEPT_ON_PHONE_DAYS = 7;
export const HANDOVER_DATABASE_NAME = "handover-checklists";

/**
 * Whether this browser holds the checklists' database. A browser that can't
 * list its databases is assumed to, so nothing is ever left behind.
 */
export async function hasHandoverDatabase(): Promise<boolean> {
  if (typeof indexedDB === "undefined") {
    return false;
  }
  if (typeof indexedDB.databases !== "function") {
    return true;
  }
  const databases = await indexedDB.databases();
  return databases.some((database) => database.name === HANDOVER_DATABASE_NAME);
}
