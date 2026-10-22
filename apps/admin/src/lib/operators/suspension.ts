import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, operators } from "@fleetapp/db/schema";
import { eq } from "drizzle-orm";

import { recordAdminActivity } from "./activity";
import type { OperatorActionDependencies } from "./dependencies";
import { lockOperator } from "./lock-operator";

interface SuspensionChange {
  operatorId: string;
  adminUserId: string;
  suspendedAt: Date | null;
}

/**
 * Sets or clears the suspension. Doing it twice is harmless: the second time
 * changes nothing and logs nothing, so a double click does not write a
 * misleading second line of history.
 */
async function changeSuspension(
  deps: OperatorActionDependencies,
  change: SuspensionChange,
): Promise<void> {
  await deps.database.transaction(async (tx) => {
    const operator = await lockOperator(tx, change.operatorId);
    const isSuspended = operator.suspendedAt !== null;
    const shouldBeSuspended = change.suspendedAt !== null;
    if (isSuspended === shouldBeSuspended) {
      return;
    }

    await tx
      .update(operators)
      .set({ suspendedAt: change.suspendedAt })
      .where(eq(operators.id, change.operatorId));

    await recordAdminActivity(tx, {
      operatorId: change.operatorId,
      adminUserId: change.adminUserId,
      entityType: ACTIVITY_ENTITY_TYPES.operator,
      entityId: change.operatorId,
      action: shouldBeSuspended ? ACTIVITY_ACTIONS.suspended : ACTIVITY_ACTIONS.reactivated,
      valuesBefore: { suspendedAt: operator.suspendedAt?.toISOString() ?? null },
      valuesAfter: { suspendedAt: change.suspendedAt?.toISOString() ?? null },
    });
  });
}

export async function suspendOperator(
  deps: OperatorActionDependencies,
  adminUserId: string,
  operatorId: string,
): Promise<void> {
  await changeSuspension(deps, { operatorId, adminUserId, suspendedAt: deps.now() });
}

export async function reactivateOperator(
  deps: OperatorActionDependencies,
  adminUserId: string,
  operatorId: string,
): Promise<void> {
  await changeSuspension(deps, { operatorId, adminUserId, suspendedAt: null });
}
