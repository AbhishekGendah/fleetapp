import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  odometerReadings,
  type ActivityAction,
  type OdometerSource,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { findCurrentVehicle } from "./current-vehicle";

/** The readings that count: verified and not withdrawn. Shared by every query that needs the current km. */
export const countedReading = and(
  eq(odometerReadings.isVerified, true),
  isNull(odometerReadings.withdrawnAt),
);

export type RecordReadingResult =
  { status: "recorded"; isLowerThanLast: boolean } | { status: "not_found" };

function logReadingActivity(
  tx: AnyTransaction,
  actor: ActingUser,
  readingId: string,
  action: ActivityAction,
  valuesAfter?: Record<string, unknown>,
): Promise<void> {
  return recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.odometerReading,
    entityId: readingId,
    action,
    valuesAfter,
  });
}

/**
 * Adds a reading, inside the caller's transaction, and logs it: by default
 * what the odometer shows now, typed by the User. The caller checks the car
 * is the Operator's.
 */
export async function addReading(
  tx: AnyTransaction,
  actor: ActingUser,
  vehicleId: string,
  kilometres: number,
  seen: { recordedAt: Date; source: OdometerSource } = { recordedAt: new Date(), source: "manual" },
): Promise<void> {
  const [reading] = await tx
    .insert(odometerReadings)
    .values({
      operatorId: actor.operatorId,
      vehicleId,
      kilometres,
      recordedAt: seen.recordedAt,
      source: seen.source,
      recordedByUserId: actor.userId,
    })
    .returning({ id: odometerReadings.id });
  if (!reading) {
    throw new Error("The reading was not saved.");
  }
  await logReadingActivity(tx, actor, reading.id, ACTIVITY_ACTIONS.created, {
    vehicleId,
    kilometres,
  });
}

/**
 * Records what the odometer shows now. A reading lower than the last one is
 * saved and flagged, never refused: the odometer may have been replaced.
 */
export async function recordOdometerReading(
  database: AnyDatabase,
  actor: ActingUser,
  vehicleId: string,
  kilometres: number,
): Promise<RecordReadingResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await findCurrentVehicle(tx, actor.operatorId, vehicleId))) {
      return { status: "not_found" };
    }
    const [latest] = await tx
      .select({ kilometres: odometerReadings.kilometres })
      .from(odometerReadings)
      .where(and(eq(odometerReadings.vehicleId, vehicleId), countedReading))
      .orderBy(desc(odometerReadings.recordedAt))
      .limit(1);

    await addReading(tx, actor, vehicleId, kilometres);
    return { status: "recorded", isLowerThanLast: latest ? kilometres < latest.kilometres : false };
  });
}

/** Takes back a reading entered by mistake. It stays on record, marked withdrawn. */
export async function withdrawOdometerReading(
  database: AnyDatabase,
  actor: ActingUser,
  readingId: string,
): Promise<"withdrawn" | "not_found"> {
  return withTenant(database, actor.operatorId, (tx) => withdrawReading(tx, actor, readingId));
}

/** As `withdrawOdometerReading`, inside the caller's transaction. */
export async function withdrawReading(
  tx: AnyTransaction,
  actor: ActingUser,
  readingId: string,
): Promise<"withdrawn" | "not_found"> {
  const [withdrawn] = await tx
    .update(odometerReadings)
    .set({ withdrawnAt: new Date() })
    .where(
      and(
        eq(odometerReadings.id, readingId),
        eq(odometerReadings.operatorId, actor.operatorId),
        isNull(odometerReadings.withdrawnAt),
      ),
    )
    .returning({ id: odometerReadings.id });
  if (!withdrawn) {
    return "not_found";
  }
  await logReadingActivity(tx, actor, readingId, ACTIVITY_ACTIONS.withdrawn);
  return "withdrawn";
}
