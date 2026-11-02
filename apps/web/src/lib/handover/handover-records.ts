import {
  operatorSettingsSchema,
  readSettings,
  type DamageMarkInput,
  type HandoverDetailsInput,
  type InspectionKind,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  inspectionDamageMarks,
  inspections,
  rentals,
  type ActivityAction,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { latestKilometres } from "../vehicles/odometer";

/**
 * A handover begins once the car is booked, a return once it is out; each is
 * finished by the Renter's acceptance (or, at a return, the business's record).
 */
export type StartHandoverResult =
  { status: "started" | "resumed"; inspectionId: string } | { status: "not_found" | "not_booked" };

export type SaveHandoverResult =
  { status: "saved" } | { status: "lower"; lastKilometres: number } | { status: "not_found" };

/** The Operator's own words on a checklist: kept with it, never written into the Log. */
const PRIVATE_FIELDS = ["accessories", "notes"] as const;

function logInspection(
  tx: AnyTransaction,
  actor: ActingUser,
  inspectionId: string,
  action: ActivityAction,
  valuesAfter?: Record<string, unknown>,
): Promise<void> {
  return recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.inspection,
    entityId: inspectionId,
    action,
    ...(valuesAfter ? { valuesAfter } : {}),
  });
}

/** The rental's checklist of this kind under way, if any. */
async function checklistUnderWay(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
  kind: InspectionKind,
): Promise<string | null> {
  const [current] = await tx
    .select({ id: inspections.id })
    .from(inspections)
    .where(
      and(
        eq(inspections.operatorId, operatorId),
        eq(inspections.rentalId, rentalId),
        eq(inspections.kind, kind),
        eq(inspections.status, "in_progress"),
      ),
    );
  return current?.id ?? null;
}

/** The photo list the handover finished with: the return asks for the same, to compare. */
async function handoverPhotoNames(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<string[] | null> {
  const [handover] = await tx
    .select({ photoNames: inspections.photoNames })
    .from(inspections)
    .where(
      and(
        eq(inspections.operatorId, operatorId),
        eq(inspections.rentalId, rentalId),
        eq(inspections.kind, "handover"),
        eq(inspections.status, "completed"),
      ),
    );
  return handover?.photoNames ?? null;
}

/** What each kind needs of the rental: booked for a handover, out (active) for a return. */
const STATUS_TO_START: Readonly<Record<InspectionKind, string>> = {
  handover: "booked",
  return: "active",
};

/**
 * Starts the rental's checklist of this kind, or picks up the one already
 * under way. A handover's photo list comes from the settings the rental
 * was made with (rule 14); a return asks for the handover's own list, so
 * each photo can be compared. The rental is locked, so two phones cannot
 * start two.
 */
async function startChecklist(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  kind: InspectionKind,
): Promise<StartHandoverResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const [rental] = await tx
      .select({
        status: rentals.status,
        vehicleId: rentals.vehicleId,
        settingsSnapshot: rentals.settingsSnapshot,
      })
      .from(rentals)
      .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, actor.operatorId)))
      .for("update");
    if (!rental) {
      return { status: "not_found" as const };
    }
    const currentId = await checklistUnderWay(tx, actor.operatorId, rentalId, kind);
    if (currentId) {
      return { status: "resumed" as const, inspectionId: currentId };
    }
    if (rental.status !== STATUS_TO_START[kind]) {
      return { status: "not_booked" as const };
    }
    const photoNames =
      kind === "handover"
        ? readSettings(operatorSettingsSchema, rental.settingsSnapshot).handoverPhotos
        : await handoverPhotoNames(tx, actor.operatorId, rentalId);
    if (!photoNames) {
      return { status: "not_booked" as const };
    }
    const [started] = await tx
      .insert(inspections)
      .values({
        operatorId: actor.operatorId,
        rentalId,
        vehicleId: rental.vehicleId,
        kind,
        photoNames,
        startedByUserId: actor.userId,
      })
      .returning({ id: inspections.id });
    await logInspection(tx, actor, started!.id, ACTIVITY_ACTIONS.created, { kind, rentalId });
    return { status: "started" as const, inspectionId: started!.id };
  });
}

/** Starts (or picks up) a booked rental's handover checklist. */
export function startHandover(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
): Promise<StartHandoverResult> {
  return startChecklist(database, actor, rentalId, "handover");
}

/** Starts (or picks up) the return checklist of a rental whose car is out. */
export function startReturn(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
): Promise<StartHandoverResult> {
  return startChecklist(database, actor, rentalId, "return");
}

export type Inspection = typeof inspections.$inferSelect;

/** The checklist under way, locked for a change; null if it is not this Operator's or is finished. */
export async function lockOpenInspection(
  tx: AnyTransaction,
  operatorId: string,
  inspectionId: string,
): Promise<Inspection | null> {
  const [inspection] = await tx
    .select()
    .from(inspections)
    .where(
      and(
        eq(inspections.id, inspectionId),
        eq(inspections.operatorId, operatorId),
        eq(inspections.status, "in_progress"),
      ),
    )
    .for("update");
  return inspection ?? null;
}

/**
 * Saves the kilometres, fuel, keys, accessories and notes. Kilometres below
 * the car's last reading are refused: a replaced odometer is recorded on the
 * car first.
 */
export async function saveHandoverDetails(
  database: AnyDatabase,
  actor: ActingUser,
  inspectionId: string,
  input: HandoverDetailsInput & { odometerKm: number },
): Promise<SaveHandoverResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const inspection = await lockOpenInspection(tx, actor.operatorId, inspectionId);
    if (!inspection) {
      return { status: "not_found" as const };
    }
    const lastKilometres = await latestKilometres(tx, inspection.vehicleId);
    if (lastKilometres !== null && input.odometerKm < lastKilometres) {
      return { status: "lower" as const, lastKilometres };
    }
    await tx
      .update(inspections)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(inspections.id, inspectionId));
    const { odometerKm, fuelLevel, keysCount } = input;
    await logInspection(tx, actor, inspectionId, ACTIVITY_ACTIONS.updated, {
      odometerKm,
      fuelLevel,
      keysCount,
      ...Object.fromEntries(PRIVATE_FIELDS.map((field) => [field, input[field] ? "set" : null])),
    });
    return { status: "saved" as const };
  });
}

/** Marks damage already on the car, while the checklist is under way. */
export async function addDamageMark(
  database: AnyDatabase,
  actor: ActingUser,
  inspectionId: string,
  input: DamageMarkInput,
): Promise<{ status: "added"; markId: string } | { status: "not_found" }> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await lockOpenInspection(tx, actor.operatorId, inspectionId))) {
      return { status: "not_found" as const };
    }
    const [mark] = await tx
      .insert(inspectionDamageMarks)
      .values({
        operatorId: actor.operatorId,
        inspectionId,
        ...input,
        createdByUserId: actor.userId,
      })
      .returning({ id: inspectionDamageMarks.id });
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.damageMark,
      entityId: mark!.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: { inspectionId, x: input.x, y: input.y },
    });
    return { status: "added" as const, markId: mark!.id };
  });
}

/** Takes a mark off the outline: kept on record, marked removed. */
export async function removeDamageMark(
  database: AnyDatabase,
  actor: ActingUser,
  inspectionId: string,
  markId: string,
): Promise<"removed" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await lockOpenInspection(tx, actor.operatorId, inspectionId))) {
      return "not_found";
    }
    const removed = await tx
      .update(inspectionDamageMarks)
      .set({ removedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(inspectionDamageMarks.id, markId),
          eq(inspectionDamageMarks.operatorId, actor.operatorId),
          eq(inspectionDamageMarks.inspectionId, inspectionId),
          isNull(inspectionDamageMarks.removedAt),
        ),
      )
      .returning({ id: inspectionDamageMarks.id });
    if (removed.length === 0) {
      return "not_found";
    }
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.damageMark,
      entityId: markId,
      action: ACTIVITY_ACTIONS.deleted,
    });
    return "removed";
  });
}

/** Stops a checklist under way; the rental stays as it was and a new one can begin. */
export async function cancelHandover(
  database: AnyDatabase,
  actor: ActingUser,
  inspectionId: string,
): Promise<"cancelled" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await lockOpenInspection(tx, actor.operatorId, inspectionId))) {
      return "not_found";
    }
    await tx
      .update(inspections)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(inspections.id, inspectionId));
    await logInspection(tx, actor, inspectionId, ACTIVITY_ACTIONS.cancelled);
    return "cancelled";
  });
}
