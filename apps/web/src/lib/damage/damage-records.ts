import { todayInTimeZone } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  damageRecords,
  inspectionDamageMarks,
  insuranceClaims,
  insurancePolicyVehicles,
  rentals,
  type ActivityAction,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { isRentalOfCar } from "../rentals/rental-of-car";
import { findCurrentVehicle } from "../vehicles/current-vehicle";
import type { ClaimInput, DamageStatusInput, FoundDamageInput } from "./damage-input";

function logDamage(
  tx: AnyTransaction,
  actor: ActingUser,
  damageId: string,
  action: ActivityAction,
  valuesAfter?: Record<string, unknown>,
): Promise<void> {
  return recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.damageRecord,
    entityId: damageId,
    action,
    ...(valuesAfter ? { valuesAfter } : {}),
  });
}

/**
 * Each new damage mark of a return becomes an open damage record, inside the
 * return's own transaction: under that rental and Renter, found the day the
 * car came back. Marks already turned into records are left alone.
 */
export async function recordDamageFromReturn(
  tx: AnyTransaction,
  actor: ActingUser,
  checklist: {
    inspectionId: string;
    rentalId: string;
    vehicleId: string;
    renterId: string;
    foundOn: string;
  },
): Promise<void> {
  const marks = await tx
    .select()
    .from(inspectionDamageMarks)
    .where(
      and(
        eq(inspectionDamageMarks.operatorId, actor.operatorId),
        eq(inspectionDamageMarks.inspectionId, checklist.inspectionId),
        isNull(inspectionDamageMarks.removedAt),
      ),
    )
    // Recorded in the order the checklist numbers them.
    .orderBy(asc(inspectionDamageMarks.createdAt), asc(inspectionDamageMarks.id));
  for (const mark of marks) {
    const [created] = await tx
      .insert(damageRecords)
      .values({
        operatorId: actor.operatorId,
        vehicleId: checklist.vehicleId,
        rentalId: checklist.rentalId,
        renterId: checklist.renterId,
        foundOn: checklist.foundOn,
        description: mark.description,
        x: mark.x,
        y: mark.y,
        returnInspectionId: checklist.inspectionId,
        damageMarkId: mark.id,
        createdByUserId: actor.userId,
      })
      .onConflictDoNothing()
      .returning({ id: damageRecords.id });
    if (created) {
      await logDamage(tx, actor, created.id, ACTIVITY_ACTIONS.created, { fromReturn: true });
    }
  }
}

/**
 * Whether a policy may go on this record's claim: this business's, and on
 * this car at some point. Archived policies stay allowed (old claims).
 */
export async function isPolicyOfCar(
  tx: AnyTransaction,
  operatorId: string,
  request: { policyId: string; vehicleId: string },
): Promise<boolean> {
  const [link] = await tx
    .select({ id: insurancePolicyVehicles.id })
    .from(insurancePolicyVehicles)
    .where(
      and(
        eq(insurancePolicyVehicles.operatorId, operatorId),
        eq(insurancePolicyVehicles.policyId, request.policyId),
        eq(insurancePolicyVehicles.vehicleId, request.vehicleId),
      ),
    )
    .limit(1);
  return link !== undefined;
}

export type FoundDamageResult = { status: "added"; damageId: string } | { status: "not_found" };

/**
 * Damage found away from a checklist. A rental given must be this car's;
 * its Renter is then the one recorded as having had the car.
 */
export async function recordFoundDamage(
  database: AnyDatabase,
  actor: ActingUser,
  vehicleId: string,
  input: FoundDamageInput,
): Promise<FoundDamageResult> {
  return withTenant(database, actor.operatorId, async (tx): Promise<FoundDamageResult> => {
    if (!(await findCurrentVehicle(tx, actor.operatorId, vehicleId))) {
      return { status: "not_found" };
    }
    const rental = input.rentalId
      ? (
          await tx
            .select({ id: rentals.id, renterId: rentals.renterId })
            .from(rentals)
            .where(
              and(
                eq(rentals.id, input.rentalId),
                eq(rentals.operatorId, actor.operatorId),
                isRentalOfCar(vehicleId),
              ),
            )
        )[0]
      : undefined;
    if (input.rentalId && !rental) {
      return { status: "not_found" };
    }
    const [created] = await tx
      .insert(damageRecords)
      .values({
        operatorId: actor.operatorId,
        vehicleId,
        rentalId: rental?.id ?? null,
        renterId: rental?.renterId ?? null,
        foundOn: input.foundOn,
        description: input.description,
        x: input.x,
        y: input.y,
        createdByUserId: actor.userId,
      })
      .returning({ id: damageRecords.id });
    await logDamage(tx, actor, created!.id, ACTIVITY_ACTIONS.created, {
      foundOn: input.foundOn,
      rentalId: rental?.id ?? null,
    });
    return { status: "added", damageId: created!.id };
  });
}

/** The damage record, locked for a change; null if it is not this business's or is archived. */
async function lockDamage(tx: AnyTransaction, operatorId: string, damageId: string) {
  const [record] = await tx
    .select()
    .from(damageRecords)
    .where(
      and(
        eq(damageRecords.id, damageId),
        eq(damageRecords.operatorId, operatorId),
        isNull(damageRecords.archivedAt),
      ),
    )
    .for("update");
  return record ?? null;
}

/** Open, repaired, or not repairing with the reason. */
export async function changeDamageStatus(
  database: AnyDatabase,
  actor: ActingUser,
  damageId: string,
  input: DamageStatusInput,
): Promise<"changed" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await lockDamage(tx, actor.operatorId, damageId))) {
      return "not_found";
    }
    await tx
      .update(damageRecords)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(damageRecords.id, damageId));
    // The note is the Operator's own words: kept on the record, never in the Log.
    await logDamage(tx, actor, damageId, ACTIVITY_ACTIONS.statusChanged, {
      status: input.status,
    });
    return "changed";
  });
}

/**
 * Adds the record's insurance claim, or saves changes to it. The notes stay
 * with the claim; the Log gets its status and amounts.
 */
export async function saveClaim(
  database: AnyDatabase,
  actor: ActingUser,
  damageId: string,
  input: ClaimInput,
): Promise<"saved" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const record = await lockDamage(tx, actor.operatorId, damageId);
    if (!record) {
      return "not_found";
    }
    const isPolicyAllowed =
      input.policyId === null ||
      (await isPolicyOfCar(tx, actor.operatorId, {
        policyId: input.policyId,
        vehicleId: record.vehicleId,
      }));
    if (!isPolicyAllowed) {
      return "not_found";
    }
    const values = { ...input, updatedAt: new Date() };
    const [claim] = await tx
      .insert(insuranceClaims)
      .values({
        operatorId: actor.operatorId,
        damageRecordId: damageId,
        createdByUserId: actor.userId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [insuranceClaims.operatorId, insuranceClaims.damageRecordId],
        set: values,
      })
      .returning({ id: insuranceClaims.id });
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.insuranceClaim,
      entityId: claim!.id,
      action: ACTIVITY_ACTIONS.updated,
      valuesAfter: {
        damageRecordId: damageId,
        status: input.status,
        excessCents: input.excessCents,
        payoutCents: input.payoutCents,
      },
    });
    return "saved";
  });
}

/**
 * Who had the car, confirmed or cleared for damage found later: a rental of
 * this car, whose Renter is recorded with it. A return's record keeps its
 * rental, which the return proved.
 */
export async function confirmDamageRental(
  database: AnyDatabase,
  actor: ActingUser,
  damageId: string,
  rentalId: string | null,
): Promise<"changed" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const record = await lockDamage(tx, actor.operatorId, damageId);
    if (!record || record.damageMarkId) {
      return "not_found";
    }
    const [rental] = rentalId
      ? await tx
          .select({ id: rentals.id, renterId: rentals.renterId })
          .from(rentals)
          .where(
            and(
              eq(rentals.id, rentalId),
              eq(rentals.operatorId, actor.operatorId),
              isRentalOfCar(record.vehicleId),
            ),
          )
      : [];
    if (rentalId && !rental) {
      return "not_found";
    }
    const holder = { rentalId: rental?.id ?? null, renterId: rental?.renterId ?? null };
    await tx
      .update(damageRecords)
      .set({ ...holder, updatedAt: new Date() })
      .where(eq(damageRecords.id, damageId));
    await logDamage(tx, actor, damageId, ACTIVITY_ACTIONS.updated, { rentalId: holder.rentalId });
    return "changed";
  });
}

/**
 * Takes away a record added by mistake (rule 13: archived, never deleted).
 * A return's records stay: they are marked Not repairing instead.
 */
export async function archiveFoundDamage(
  database: AnyDatabase,
  actor: ActingUser,
  damageId: string,
): Promise<"archived" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const record = await lockDamage(tx, actor.operatorId, damageId);
    if (!record || record.damageMarkId) {
      return "not_found";
    }
    const now = new Date();
    await tx
      .update(damageRecords)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(damageRecords.id, damageId));
    await logDamage(tx, actor, damageId, ACTIVITY_ACTIONS.archived);
    return "archived";
  });
}

/** The car a damage record is on, for adding its photos; null if not this business's. */
export async function findDamageCar(
  database: AnyDatabase,
  operatorId: string,
  damageId: string,
): Promise<string | null> {
  const [record] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ vehicleId: damageRecords.vehicleId })
      .from(damageRecords)
      .where(
        and(
          eq(damageRecords.id, damageId),
          eq(damageRecords.operatorId, operatorId),
          isNull(damageRecords.archivedAt),
        ),
      ),
  );
  return record?.vehicleId ?? null;
}

/** The business's today, for damage found "today" (rule 10). */
export function todayFor(timeZone: string, now: Date = new Date()): string {
  return todayInTimeZone(now, timeZone);
}
