import type { AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, possessions } from "@fleetapp/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";

/**
 * The Renter's time with a car starts (rule 15): at a handover's acceptance,
 * or the new car at a swap. Its own history line, so who had which car when
 * can be read straight from the log (review A6-12, G9-8).
 */
export async function startPossession(
  tx: AnyTransaction,
  actor: ActingUser,
  possession: {
    rentalId: string;
    vehicleId: string;
    renterId: string;
    startedAt: Date;
    handoverInspectionId: string;
  },
): Promise<void> {
  const [started] = await tx
    .insert(possessions)
    .values({ operatorId: actor.operatorId, ...possession })
    .returning({ id: possessions.id });
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.possession,
    entityId: started!.id,
    action: ACTIVITY_ACTIONS.started,
    valuesAfter: {
      vehicleId: possession.vehicleId,
      renterId: possession.renterId,
      startedAt: possession.startedAt.toISOString(),
    },
  });
}

/** The rental's open possession ends: at the recorded return, or the old car at a swap. */
export async function endPossession(
  tx: AnyTransaction,
  actor: ActingUser,
  ending: { rentalId: string; endedAt: Date; returnInspectionId: string },
): Promise<void> {
  const ended = await tx
    .update(possessions)
    .set({
      endedAt: ending.endedAt,
      returnInspectionId: ending.returnInspectionId,
      updatedAt: ending.endedAt,
    })
    .where(
      and(
        eq(possessions.operatorId, actor.operatorId),
        eq(possessions.rentalId, ending.rentalId),
        isNull(possessions.endedAt),
      ),
    )
    .returning({ id: possessions.id, vehicleId: possessions.vehicleId });
  for (const possession of ended) {
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.possession,
      entityId: possession.id,
      action: ACTIVITY_ACTIONS.ended,
      valuesAfter: { vehicleId: possession.vehicleId, endedAt: ending.endedAt.toISOString() },
    });
  }
}
