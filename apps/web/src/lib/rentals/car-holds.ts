import { isCarStillOutFor, isExclusionViolation, type CarSpan } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  carHolds,
  possessions,
  rentals,
} from "@fleetapp/db/schema";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";

/** The database rule that keeps two holds on one car apart (migration 0028). */
const CAR_HOLDS_NO_OVERLAP = "car_holds_no_overlap";
/** The database rule that keeps a car still out past its end from being booked (migration 0054). */
const CAR_HOLDS_NOT_WHILE_OUT = "car_holds_not_while_out";

/**
 * A span as Postgres writes a time range: from (included) up to (not
 * included), so one booking can end exactly as the next begins. No end
 * means open-ended, as for an ongoing rental.
 */
export function heldRange(start: Date, end: Date | null): string {
  return `[${start.toISOString()},${end?.toISOString() ?? ""})`;
}

/** The other booking already holding the car for some of that time. */
export interface BookingClash {
  rentalId: string;
  plannedStart: Date;
  plannedEnd: Date | null;
}

/** The car is still out with another rental past that rental's planned end: not free until it is back. */
export interface StillOutClash {
  kind: "still_out";
  rentalId: string;
  dueBack: Date;
}

/** Why a car can't be newly held for a span: another booking, or still out late. */
export type NewHoldClash = BookingClash | StillOutClash;

export function isStillOutClash(clash: NewHoldClash): clash is StillOutClash {
  return "kind" in clash && clash.kind === "still_out";
}

/**
 * The first live hold on this car that overlaps the span, if any. Asked
 * before writing so the Operator is told which booking is in the way; the
 * database rule still has the last word if two bookings race. Used as it is
 * when a rental's own hold moves (a new end, an early handover): a hold the
 * rental already has can only grow into another hold, never newly into a
 * car still out late, so that check is for new holds only
 * (`findNewHoldClash`).
 */
export async function findBookingClash(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
  span: CarSpan,
  /** A rental whose own hold does not count, e.g. the one being made longer. */
  exceptRentalId?: string,
): Promise<BookingClash | null> {
  const [clash] = await tx
    .select({
      rentalId: rentals.id,
      plannedStart: rentals.plannedStart,
      plannedEnd: rentals.plannedEnd,
    })
    .from(carHolds)
    .innerJoin(
      rentals,
      and(eq(rentals.id, carHolds.rentalId), eq(rentals.operatorId, carHolds.operatorId)),
    )
    .where(
      and(
        eq(carHolds.operatorId, operatorId),
        eq(carHolds.vehicleId, vehicleId),
        isNull(carHolds.releasedAt),
        exceptRentalId ? ne(carHolds.rentalId, exceptRentalId) : undefined,
        sql`${carHolds.heldDuring} && ${heldRange(span.start, span.end)}::tstzrange`,
      ),
    )
    .orderBy(rentals.plannedStart)
    .limit(1);
  return clash ?? null;
}

/** Another rental's Renter has the car now, due back at its planned end (none when ongoing). */
export interface CarOutWithAnother {
  rentalId: string;
  dueBack: Date | null;
}

/**
 * The rental, other than `exceptRentalId`, whose Renter has this car now, if
 * any. There is at most one open possession of a car (rule 15's exclusion
 * rule).
 */
export async function findCarOutWithAnother(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
  exceptRentalId?: string | null,
): Promise<CarOutWithAnother | null> {
  const [out] = await tx
    .select({ rentalId: possessions.rentalId, dueBack: rentals.plannedEnd })
    .from(possessions)
    .innerJoin(
      rentals,
      and(eq(rentals.id, possessions.rentalId), eq(rentals.operatorId, possessions.operatorId)),
    )
    .where(
      and(
        eq(possessions.operatorId, operatorId),
        eq(possessions.vehicleId, vehicleId),
        isNull(possessions.endedAt),
        exceptRentalId ? ne(possessions.rentalId, exceptRentalId) : undefined,
      ),
    )
    .limit(1);
  return out ?? null;
}

/**
 * Another rental still out with this car past its planned end, when the span
 * reaches past that end (decision 5 of docs/plans/find-a-car.md).
 */
export async function findCarStillOut(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
  span: CarSpan,
  now: Date,
  exceptRentalId?: string,
): Promise<StillOutClash | null> {
  const out = await findCarOutWithAnother(tx, operatorId, vehicleId, exceptRentalId);
  if (!out?.dueBack || !isCarStillOutFor(span, out.dueBack, now)) {
    return null;
  }
  return { kind: "still_out", rentalId: out.rentalId, dueBack: out.dueBack };
}

/**
 * What stops the car being newly held for the span: still out late with
 * another rental (said first, as no other dates would help), or another
 * booking's hold. For a booking, a draft being booked and a swap's new car.
 */
export async function findNewHoldClash(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
  span: CarSpan,
  now: Date,
  exceptRentalId?: string,
): Promise<NewHoldClash | null> {
  return (
    (await findCarStillOut(tx, operatorId, vehicleId, span, now, exceptRentalId)) ??
    (await findBookingClash(tx, operatorId, vehicleId, span, exceptRentalId))
  );
}

/** Holds the car for the rental's span. */
export async function holdCar(
  tx: AnyTransaction,
  operatorId: string,
  hold: { vehicleId: string; rentalId: string; start: Date; end: Date | null },
): Promise<void> {
  await tx.insert(carHolds).values({
    operatorId,
    vehicleId: hold.vehicleId,
    rentalId: hold.rentalId,
    heldDuring: heldRange(hold.start, hold.end),
  });
}

/** Lets the car go: the rental no longer keeps it for any time. Each let go is logged (review A6-12). */
export async function releaseCarHolds(
  tx: AnyTransaction,
  actor: ActingUser,
  rentalId: string,
  releasedAt: Date,
  onlyVehicleId?: string,
): Promise<void> {
  const released = await tx
    .update(carHolds)
    .set({ releasedAt })
    .where(
      and(
        eq(carHolds.operatorId, actor.operatorId),
        eq(carHolds.rentalId, rentalId),
        isNull(carHolds.releasedAt),
        onlyVehicleId ? eq(carHolds.vehicleId, onlyVehicleId) : undefined,
      ),
    )
    .returning({ id: carHolds.id });
  for (const hold of released) {
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.carHold,
      entityId: hold.id,
      action: ACTIVITY_ACTIONS.released,
      valuesAfter: { releasedAt: releasedAt.toISOString() },
    });
  }
}

/**
 * True if the database refused a hold because another booking took the car
 * first, or the car is still out late with another rental.
 */
export function isCarAlreadyHeld(error: unknown): boolean {
  return (
    isExclusionViolation(error, CAR_HOLDS_NO_OVERLAP) ||
    isExclusionViolation(error, CAR_HOLDS_NOT_WHILE_OUT)
  );
}
