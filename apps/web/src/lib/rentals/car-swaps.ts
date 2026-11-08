import { canSwapCar, operatorSettingsSchema, readSettings } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  carSwaps,
  inspections,
  rentals,
  vehicles,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { loadDefaultTemplate } from "../contracts/templates";
import { handoverPhotoNames, isChecklistUnderWay } from "../handover/handover-records";
import { findNewHoldClash, type NewHoldClash } from "./car-holds";
import type { RentalClock } from "./rental-records";

export type CarSwap = typeof carSwaps.$inferSelect;

export type StartSwapResult =
  | { status: "started" | "resumed"; swapId: string }
  | { status: "clash"; clash: NewHoldClash }
  | {
      status:
        | "not_found"
        | "not_out"
        | "same_car"
        | "car_not_available"
        | "return_under_way"
        | "no_template";
    };

/** The swap under way for the rental, if any. */
export async function swapUnderWay(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<CarSwap | null> {
  const [swap] = await tx
    .select()
    .from(carSwaps)
    .where(
      and(
        eq(carSwaps.operatorId, operatorId),
        eq(carSwaps.rentalId, rentalId),
        eq(carSwaps.status, "in_progress"),
      ),
    );
  return swap ?? null;
}

/** The new car can go out: this business's, in the fleet, Available. */
async function isCarAvailable(tx: AnyTransaction, operatorId: string, vehicleId: string) {
  const [car] = await tx
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.id, vehicleId),
        eq(vehicles.operatorId, operatorId),
        eq(vehicles.status, "available"),
        isNull(vehicles.archivedAt),
      ),
    );
  return car !== undefined;
}

/** Adds one of the swap's two checklists. */
async function addSwapChecklist(
  tx: AnyTransaction,
  actor: ActingUser,
  checklist: {
    rentalId: string;
    vehicleId: string;
    kind: "handover" | "return";
    photoNames: string[];
  },
): Promise<string> {
  const [started] = await tx
    .insert(inspections)
    .values({
      operatorId: actor.operatorId,
      ...checklist,
      isForSwap: true,
      startedByUserId: actor.userId,
    })
    .returning({ id: inspections.id });
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.inspection,
    entityId: started!.id,
    action: ACTIVITY_ACTIONS.created,
    valuesAfter: { kind: checklist.kind, vehicleId: checklist.vehicleId, isForSwap: true },
  });
  return started!.id;
}

/**
 * Starts a swap into another car (or picks up the one under way): the old
 * car's return checklist (the photos its handover took, to compare) and the
 * new car's handover checklist (the rental's own photo list, rule 14). The
 * new car must be Available and free for the rest of the rental; the swap
 * form template must exist, so the swap is not found to be impossible at
 * the end.
 */
export async function startSwap(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  request: { toVehicleId: string; reason: string },
  clock: RentalClock,
): Promise<StartSwapResult> {
  if (!(await loadDefaultTemplate(database, actor.operatorId, "swap_form"))) {
    return { status: "no_template" };
  }
  return withTenant(database, actor.operatorId, async (tx): Promise<StartSwapResult> => {
    const [rental] = await tx
      .select()
      .from(rentals)
      .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, actor.operatorId)))
      .for("update");
    if (!rental) {
      return { status: "not_found" };
    }
    const current = await swapUnderWay(tx, actor.operatorId, rentalId);
    if (current) {
      return { status: "resumed", swapId: current.id };
    }
    if (!canSwapCar(rental.status)) {
      return { status: "not_out" };
    }
    if (request.toVehicleId === rental.vehicleId) {
      return { status: "same_car" };
    }
    if (await isChecklistUnderWay(tx, actor.operatorId, rentalId)) {
      return { status: "return_under_way" };
    }
    if (!(await isCarAvailable(tx, actor.operatorId, request.toVehicleId))) {
      return { status: "car_not_available" };
    }
    const clash = await findNewHoldClash(
      tx,
      actor.operatorId,
      request.toVehicleId,
      {
        start: clock.now,
        end: rental.plannedEnd && rental.plannedEnd > clock.now ? rental.plannedEnd : null,
      },
      clock.now,
      rentalId,
    );
    if (clash) {
      return { status: "clash", clash };
    }
    const oldCar = { rentalId, vehicleId: rental.vehicleId };
    const returnInspectionId = await addSwapChecklist(tx, actor, {
      ...oldCar,
      kind: "return",
      photoNames: (await handoverPhotoNames(tx, actor.operatorId, oldCar)) ?? [],
    });
    const handoverInspectionId = await addSwapChecklist(tx, actor, {
      rentalId,
      vehicleId: request.toVehicleId,
      kind: "handover",
      photoNames: readSettings(operatorSettingsSchema, rental.settingsSnapshot).handoverPhotos,
    });
    const [swap] = await tx
      .insert(carSwaps)
      .values({
        operatorId: actor.operatorId,
        rentalId,
        fromVehicleId: rental.vehicleId,
        toVehicleId: request.toVehicleId,
        reason: request.reason,
        returnInspectionId,
        handoverInspectionId,
        startedByUserId: actor.userId,
      })
      .returning({ id: carSwaps.id });
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.carSwap,
      entityId: swap!.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: { rentalId, fromVehicleId: rental.vehicleId, toVehicleId: request.toVehicleId },
    });
    return { status: "started", swapId: swap!.id };
  });
}

/** Stops a swap under way: both checklists are cancelled and the Renter keeps the old car. */
export async function cancelSwap(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
): Promise<"cancelled" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const swap = await swapUnderWay(tx, actor.operatorId, rentalId);
    if (!swap) {
      return "not_found";
    }
    const now = new Date();
    await tx
      .update(inspections)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(
        and(
          eq(inspections.operatorId, actor.operatorId),
          inArray(inspections.id, [swap.returnInspectionId, swap.handoverInspectionId]),
          eq(inspections.status, "in_progress"),
        ),
      );
    await tx
      .update(carSwaps)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(eq(carSwaps.id, swap.id));
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.carSwap,
      entityId: swap.id,
      action: ACTIVITY_ACTIONS.cancelled,
      valuesAfter: { rentalId },
    });
    return "cancelled";
  });
}

export interface SwapSummary extends CarSwap {
  fromRego: string;
  toRego: string;
}

/** The rental's swaps, newest first, with each car's rego. */
export async function listRentalSwaps(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
): Promise<SwapSummary[]> {
  return withTenant(database, operatorId, async (tx) => {
    const swaps = await tx
      .select()
      .from(carSwaps)
      .where(and(eq(carSwaps.operatorId, operatorId), eq(carSwaps.rentalId, rentalId)))
      .orderBy(desc(carSwaps.createdAt));
    const carIds = swaps.flatMap((swap) => [swap.fromVehicleId, swap.toVehicleId]);
    const cars =
      carIds.length === 0
        ? []
        : await tx
            .select({ id: vehicles.id, rego: vehicles.rego })
            .from(vehicles)
            .where(and(eq(vehicles.operatorId, operatorId), inArray(vehicles.id, carIds)));
    const regoOf = (id: string) => cars.find((car) => car.id === id)?.rego ?? "";
    return swaps.map((swap) => ({
      ...swap,
      fromRego: regoOf(swap.fromVehicleId),
      toRego: regoOf(swap.toVehicleId),
    }));
  });
}
