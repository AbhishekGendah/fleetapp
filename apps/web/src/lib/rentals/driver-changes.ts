import { canChangeDriver, isHandoverAllowed, type BookingProblem } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  rentalDriverChanges,
  rentals,
  renters,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { ROW_LOCK } from "@fleetapp/db/row-lock";
import { and, desc, eq, inArray } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import {
  addPairChecklist,
  cancelChecklistPair,
  handoverPhotoNames,
  isChecklistUnderWay,
} from "../handover/handover-records";
import {
  findDriverChangeProblems,
  lockDriverNamingParties,
  type MissingParty,
} from "./booking-checks";
import type { StartDriverChangeInput } from "./driver-change-input";
import type { RentalClock } from "./rental-records";
import { swapUnderWay } from "./car-swaps";
import { driverChangeUnderWay, type DriverChange } from "./driver-change-under-way";

export { driverChangeUnderWay, type DriverChange } from "./driver-change-under-way";

export type StartDriverChangeResult =
  | { status: "started" | "resumed"; changeId: string }
  | { status: "refused"; problems: BookingProblem[] }
  | {
      status:
        | MissingParty
        | "not_found"
        | "not_out"
        | "same_driver"
        | "swap_under_way"
        | "change_under_way"
        | "checklist_under_way";
    };

/** The rental, locked first ("Lock order"); none if it is not this Operator's. */
async function lockRentalRow(tx: AnyTransaction, operatorId: string, rentalId: string) {
  const [rental] = await tx
    .select()
    .from(rentals)
    .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)))
    .for(ROW_LOCK);
  return rental ?? null;
}

/** What stops a driver change starting now, before anything is locked beyond the rental. */
async function startRefusal(
  tx: AnyTransaction,
  operatorId: string,
  rental: typeof rentals.$inferSelect,
  toDriverId: string,
): Promise<StartDriverChangeResult | null> {
  if (rental.status !== "active") {
    return { status: "not_out" };
  }
  if (rental.driverId === toDriverId) {
    return { status: "same_driver" };
  }
  if (await swapUnderWay(tx, operatorId, rental.id)) {
    return { status: "swap_under_way" };
  }
  // A return under way has the car's check-in already: the change waits for it.
  return (await isChecklistUnderWay(tx, operatorId, rental.id))
    ? { status: "checklist_under_way" }
    : null;
}

/**
 * Starts changing a business's driver while its car is out (decision 4), or
 * picks up the change to that same driver under way (one to another driver
 * is refused, never resumed): the car is checked in from the driver who
 * has it (a return checklist asking for the photos its handover took), then
 * signed for by the new driver (a handover checklist showing that check-in).
 * Locked as everything else that changes a rental (docs/plans/
 * business-renters.md, "Lock order"): the rental, then the car, the business
 * and the new driver, whose checks run now (and again as they sign).
 */
export async function startDriverChange(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  request: StartDriverChangeInput,
  clock: RentalClock,
): Promise<StartDriverChangeResult> {
  return withTenant(database, actor.operatorId, async (tx): Promise<StartDriverChangeResult> => {
    const rental = await lockRentalRow(tx, actor.operatorId, rentalId);
    if (!rental) {
      return { status: "not_found" };
    }
    const current = await driverChangeUnderWay(tx, actor.operatorId, rentalId);
    if (current) {
      // Picked up only for the same driver: one to another would silently hand the car elsewhere.
      return current.toDriverId === request.toDriverId
        ? { status: "resumed", changeId: current.id }
        : { status: "change_under_way" };
    }
    const refusal = await startRefusal(tx, actor.operatorId, rental, request.toDriverId);
    if (refusal) {
      return refusal;
    }
    const parties = await lockDriverNamingParties(
      tx,
      actor.operatorId,
      {
        renterId: rental.renterId,
        vehicleId: rental.vehicleId,
        driverId: request.toDriverId,
        outgoingDriverId: rental.driverId ?? undefined,
      },
      null,
    );
    if (typeof parties === "string") {
      return { status: parties };
    }
    if (
      !parties.driver ||
      rental.driverId === null ||
      !canChangeDriver(rental.status, parties.renter.kind)
    ) {
      return { status: "not_out" };
    }
    const problems = await findDriverChangeProblems(tx, parties.driver, rental, clock);
    if (!isHandoverAllowed(problems)) {
      return { status: "refused", problems };
    }
    const car = { rentalId, vehicleId: rental.vehicleId };
    const photoNames = (await handoverPhotoNames(tx, actor.operatorId, car)) ?? [];
    const checklist = (kind: "return" | "handover") =>
      addPairChecklist(tx, actor, { ...car, kind, photoNames }, "driverChange");
    const returnInspectionId = await checklist("return");
    const handoverInspectionId = await checklist("handover");
    const [change] = await tx
      .insert(rentalDriverChanges)
      .values({
        operatorId: actor.operatorId,
        rentalId,
        fromDriverId: rental.driverId,
        toDriverId: parties.driver.id,
        reason: request.reason,
        returnInspectionId,
        handoverInspectionId,
        startedByUserId: actor.userId,
      })
      .returning({ id: rentalDriverChanges.id });
    // Record ids only: the reason is the Operator's own words, kept with the change (rule 7).
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.driverChange,
      entityId: change!.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: { rentalId, fromDriverId: rental.driverId, toDriverId: parties.driver.id },
    });
    return { status: "started", changeId: change!.id };
  });
}

/** Cancelled; the rental isn't this Operator's; or its change was finished or cancelled meanwhile. */
export type CancelDriverChangeResult = "cancelled" | "not_found" | "finished_already";

/**
 * Stops a driver change under way: both checklists are cancelled and the
 * driver who has the car keeps it. Locked in signing's order (the rental,
 * the change, then its two checklists), so a signature at the same moment
 * waits or is waited for, and whichever waited finds the other's result.
 */
export async function cancelDriverChange(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
): Promise<CancelDriverChangeResult> {
  return withTenant(database, actor.operatorId, async (tx): Promise<CancelDriverChangeResult> => {
    if (!(await lockRentalRow(tx, actor.operatorId, rentalId))) {
      return "not_found";
    }
    const change = await driverChangeUnderWay(tx, actor.operatorId, rentalId, true);
    if (!change) {
      return "finished_already";
    }
    const now = new Date();
    await cancelChecklistPair(tx, actor.operatorId, change, now);
    await tx
      .update(rentalDriverChanges)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(eq(rentalDriverChanges.id, change.id));
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.driverChange,
      entityId: change.id,
      action: ACTIVITY_ACTIONS.cancelled,
      valuesAfter: { rentalId },
    });
    return "cancelled";
  });
}

export interface DriverChangeSummary extends DriverChange {
  fromName: string;
  toName: string;
}

/** The rental's driver changes, newest first, with each driver's name. */
export async function listRentalDriverChanges(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
): Promise<DriverChangeSummary[]> {
  return withTenant(database, operatorId, async (tx) => {
    const changes = await tx
      .select()
      .from(rentalDriverChanges)
      .where(
        and(
          eq(rentalDriverChanges.operatorId, operatorId),
          eq(rentalDriverChanges.rentalId, rentalId),
        ),
      )
      .orderBy(desc(rentalDriverChanges.createdAt));
    const ids = changes.flatMap((change) => [change.fromDriverId, change.toDriverId]);
    const people =
      ids.length === 0
        ? []
        : await tx
            .select({ id: renters.id, fullName: renters.fullName })
            .from(renters)
            .where(and(eq(renters.operatorId, operatorId), inArray(renters.id, ids)));
    const nameOf = (id: string) => people.find((person) => person.id === id)?.fullName ?? "";
    return changes.map((change) => ({
      ...change,
      fromName: nameOf(change.fromDriverId),
      toName: nameOf(change.toDriverId),
    }));
  });
}
