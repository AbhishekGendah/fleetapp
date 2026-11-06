"use server";

import type { QuickSearchGroup } from "@fleetapp/ui/quick-search";

import { appDb } from "../lib/app-db";
import { requireUser } from "../lib/require-user";
import { headerSearchGroups } from "../lib/search/header-search-groups";
import { headerSearchTextSchema } from "../lib/search/header-search-input";
import { searchOperatorRecords } from "../lib/search/header-search-queries";

/**
 * The top bar's search as you type: the signed-in User's own Operator's
 * cars, Renters and rentals only. Text too short or too long finds nothing.
 */
export async function searchHeaderAction(text: string): Promise<QuickSearchGroup[]> {
  const user = await requireUser();
  const parsed = headerSearchTextSchema.safeParse(text);
  if (!parsed.success) {
    return [];
  }
  return headerSearchGroups(await searchOperatorRecords(appDb, user.operatorId, parsed.data));
}
