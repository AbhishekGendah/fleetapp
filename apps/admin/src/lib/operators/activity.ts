import { activityLog, type ActivityAction, type ActivityEntityType } from "@fleetapp/db/schema";

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

/**
 * Writes one line of the Operator's history, inside the same transaction as
 * the change it describes, so a change cannot happen without its log line.
 * Never pass a token or a password in the values (rule 7).
 */
export async function recordAdminActivity(
  tx: Transaction,
  entry: AdminActivityEntry,
): Promise<void> {
  await tx.insert(activityLog).values({
    operatorId: entry.operatorId,
    actorType: "admin",
    actorId: entry.adminUserId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    valuesBefore: entry.valuesBefore ?? null,
    valuesAfter: entry.valuesAfter ?? null,
  });
}
