import { isExclusionViolation } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { carHolds, rentals } from "@fleetapp/db/schema";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

/** The database rule that keeps two holds on one car apart (migration 0028). */
const CAR_HOLDS_NO_OVERLAP = "car_holds_no_overlap";

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

/**
 * The first live hold on this car that overlaps the span, if any. Asked
 * before writing so the Operator is told which booking is in the way; the
 * database rule still has the last word if two bookings race.
 */
export async function findBookingClash(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
  span: { start: Date; end: Date | null },
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

/** Lets the car go: the rental no longer keeps it for any time. */
export async function releaseCarHolds(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
  releasedAt: Date,
): Promise<void> {
  await tx
    .update(carHolds)
    .set({ releasedAt })
    .where(
      and(
        eq(carHolds.operatorId, operatorId),
        eq(carHolds.rentalId, rentalId),
        isNull(carHolds.releasedAt),
      ),
    );
}

/** True if the database refused a hold because another booking took the car first. */
export function isCarAlreadyHeld(error: unknown): boolean {
  return isExclusionViolation(error, CAR_HOLDS_NO_OVERLAP);
}
