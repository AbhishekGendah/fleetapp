import type { AnyTransaction } from "@fleetapp/db/client";
import { adminActivityLog, type AdminActivityAction } from "@fleetapp/db/schema";

export interface AdminChange {
  action: AdminActivityAction;
  entityType: string;
  entityId: string;
  valuesBefore?: Record<string, unknown>;
  valuesAfter?: Record<string, unknown>;
}

/** One line of the Admin activity log for a change to AGS's own records, in the same transaction. */
export async function recordAdminChange(
  tx: AnyTransaction,
  adminUserId: string,
  change: AdminChange,
): Promise<void> {
  await tx.insert(adminActivityLog).values({
    adminUserId,
    action: change.action,
    entityType: change.entityType,
    entityId: change.entityId,
    valuesBefore: change.valuesBefore ?? null,
    valuesAfter: change.valuesAfter ?? null,
  });
}
