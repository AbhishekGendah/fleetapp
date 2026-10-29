import { recordActivity } from "@fleetapp/db/activity";
import type { ActivityAction, ActivityEntityType } from "@fleetapp/db/schema";

import type { Transaction } from "./dependencies";

export interface AdminActivityEntry {
  operatorId: string;
  adminUserId: string;
  entityType: ActivityEntityType;
  entityId: string;
  action: ActivityAction;
  valuesBefore?: Record<string, unknown>;
  valuesAfter?: Record<string, unknown>;
}

/** A line of the Operator's history written by an Admin, in the same transaction as the change. */
export async function recordAdminActivity(
  tx: Transaction,
  { adminUserId, ...entry }: AdminActivityEntry,
): Promise<void> {
  await recordActivity(tx, { ...entry, actor: { type: "admin", id: adminUserId } });
}
