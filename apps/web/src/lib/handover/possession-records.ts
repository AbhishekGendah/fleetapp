import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  carHolds,
  possessions,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
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
  carRego: string,
): Promise<void> {
  const [started] = await tx
    .insert(possessions)
    .values({ operatorId: actor.operatorId, ...possession })
    .returning({ id: possessions.id });
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.possession,
    entityId: started!.id,
    action: ACTIVITY_ACTIONS.started,
    valuesAfter: { carRego, startedAt: possession.startedAt.toISOString() },
  });
}

/** The rental's open possession ends: at the recorded return, or the old car at a swap. */
export async function endPossession(
  tx: AnyTransaction,
  actor: ActingUser,
  ending: { rentalId: string; endedAt: Date; returnInspectionId: string; carRego: string },
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
    .returning({ id: possessions.id });
  for (const possession of ended) {
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.possession,
      entityId: possession.id,
      action: ACTIVITY_ACTIONS.ended,
      valuesAfter: { carRego: ending.carRego, endedAt: ending.endedAt.toISOString() },
    });
  }
}

/** A rental's possessions and car holds, for its Log. */
export async function possessionAndHoldIdsOf(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
): Promise<{ possessionIds: string[]; holdIds: string[] }> {
  return withTenant(database, operatorId, async (tx) => {
    const ofRental = (table: typeof possessions | typeof carHolds) =>
      and(eq(table.operatorId, operatorId), eq(table.rentalId, rentalId));
    const [held, holds] = await Promise.all([
      tx.select({ id: possessions.id }).from(possessions).where(ofRental(possessions)),
      tx.select({ id: carHolds.id }).from(carHolds).where(ofRental(carHolds)),
    ]);
    return { possessionIds: held.map((row) => row.id), holdIds: holds.map((row) => row.id) };
  });
}
