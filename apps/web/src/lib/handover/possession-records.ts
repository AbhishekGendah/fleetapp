import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  carHolds,
  possessions,
  renters,
  vehicles,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";

/**
 * The driver's time with a car starts (rule 15): at a handover's acceptance,
 * or the new car at a swap. `renterId` is the rental's Renter (who pays),
 * `driverId` who has the car: the same person for a person's own rental. Its own history line, so who had which car when
 * can be read straight from the log (review A6-12, G9-8).
 */
export async function startPossession(
  tx: AnyTransaction,
  actor: ActingUser,
  possession: {
    rentalId: string;
    vehicleId: string;
    renterId: string;
    driverId: string;
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

/**
 * The rental's open possession ends: at the recorded return, the old car at
 * a swap, or the driver who had it at a driver change. Gives back who had
 * it, read from the possession itself under the lock this takes (none if
 * none was open), so whatever starts next follows the record, never the
 * rental's driver as some screen showed it (slice 4).
 */
export async function endPossession(
  tx: AnyTransaction,
  actor: ActingUser,
  ending: { rentalId: string; endedAt: Date; returnInspectionId: string; carRego: string },
): Promise<string | null> {
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
    .returning({ id: possessions.id, driverId: possessions.driverId });
  for (const possession of ended) {
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.possession,
      entityId: possession.id,
      action: ACTIVITY_ACTIONS.ended,
      valuesAfter: { carRego: ending.carRego, endedAt: ending.endedAt.toISOString() },
    });
  }
  return ended[0]?.driverId ?? null;
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

/** One driver's time with one of the rental's cars, as fines are matched to it (rule 15). */
export interface RentalPossession {
  id: string;
  driverId: string;
  driverName: string;
  carRego: string;
  startedAt: Date;
  /** None while they still have it. */
  endedAt: Date | null;
}

/** Who had the rental's cars and when, oldest first: from the possession records, never the rental's driver now. */
export async function listRentalPossessions(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
): Promise<RentalPossession[]> {
  return withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: possessions.id,
        driverId: possessions.driverId,
        driverName: renters.fullName,
        carRego: vehicles.rego,
        startedAt: possessions.startedAt,
        endedAt: possessions.endedAt,
      })
      .from(possessions)
      .innerJoin(
        renters,
        and(eq(renters.id, possessions.driverId), eq(renters.operatorId, possessions.operatorId)),
      )
      .innerJoin(
        vehicles,
        and(
          eq(vehicles.id, possessions.vehicleId),
          eq(vehicles.operatorId, possessions.operatorId),
        ),
      )
      .where(and(eq(possessions.operatorId, operatorId), eq(possessions.rentalId, rentalId)))
      .orderBy(asc(possessions.startedAt)),
  );
}
