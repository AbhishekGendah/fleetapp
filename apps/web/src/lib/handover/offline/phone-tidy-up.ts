import {
  forgetAllChecklistPages,
  forgetChecklistPages,
  forgetOldChecklistPages,
} from "./checklist-pages";
import { hasHandoverDatabase } from "./phone-limits";

/**
 * The phone wipes, used on every page. The checklists' database code is
 * loaded only on a phone that holds one, so other pages stay small.
 */

type HandoverStore = typeof import("./handover-store");

/** The checklists' database code, if this phone holds the database; null if not. */
async function storeIfAny(): Promise<HandoverStore | null> {
  return (await hasHandoverDatabase()) ? import("./handover-store") : null;
}

/** Wipes a rental's ended checklists from this phone, keeping those still under way. */
export async function forgetEndedChecklists(
  rentalId: string,
  endedInspectionIds: readonly string[],
  openPagePaths: readonly string[],
): Promise<void> {
  const forgetTyping = async () => (await storeIfAny())?.forgetHandovers(endedInspectionIds);
  await Promise.all([forgetTyping(), forgetChecklistPages(rentalId, openPagePaths)]);
}

/** The week's limit, checked whenever the app opens (review A6-4). */
export async function forgetWeekOldChecklists(): Promise<void> {
  const forgetTyping = async () => (await storeIfAny())?.forgetOldHandovers();
  await Promise.all([forgetTyping(), forgetOldChecklistPages()]);
}

/** Photos and damage marks on this phone not yet sent, across every checklist. */
export async function countAllQueued(): Promise<number> {
  return (await (await storeIfAny())?.countAllQueued()) ?? 0;
}

/** Wipes every checklist from the phone, as at sign-out. */
export async function forgetEverythingOnPhone(): Promise<void> {
  const forgetTyping = async () => (await storeIfAny())?.forgetAllHandovers();
  await Promise.all([forgetTyping(), forgetAllChecklistPages()]);
}
