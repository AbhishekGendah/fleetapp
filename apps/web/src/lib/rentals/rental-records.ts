import {
  chargeWeekdayFor,
  isBookingRefused,
  operatorSettingsSchema,
  readSettings,
  todayInTimeZone,
  withholdFields,
  type BookingProblem,
  type RentalStatus,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  rentalRates,
  rentals,
  type ActivityAction,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";

import { recordUserChange, type ActingUser, type UserChange } from "../acting-user";
import { cancelLiveLinks } from "../renter-links/cancel-links";
import { snapshotOperatorSettings } from "../settings/operator-settings";
import { findBookingProblems, lockBookingParties } from "./booking-checks";
import {
  findBookingClash,
  holdCar,
  isCarAlreadyHeld,
  releaseCarHolds,
  type BookingClash,
} from "./car-holds";
import type { CancelRentalInput, RentalInput } from "./rental-input";

/** Kept as drafts or bookings; the rest (handover, return) come with later slices. */
export type NewRentalStatus = Extract<RentalStatus, "draft" | "booked">;

/** Where the clock and calendar come from: the Operator's timezone, and now. */
export interface RentalClock {
  timeZone: string;
  now: Date;
}

export type BookingResult =
  | { status: "saved"; rentalId: string; problems: BookingProblem[] }
  | { status: "refused"; problems: BookingProblem[] }
  | { status: "car_taken"; clash: BookingClash | null }
  | { status: "renter_not_found" | "car_not_found" | "not_found" | "not_allowed" };

/** The Operator's own notes on a rental: kept with it, never written into the log. */
const PRIVATE_RENTAL_FIELDS = ["notes", "cancellationReason"] as const;

type Rental = typeof rentals.$inferSelect;

function logRentalActivity(
  tx: AnyTransaction,
  actor: ActingUser,
  rentalId: string,
  action: ActivityAction,
  values: Pick<UserChange, "valuesBefore" | "valuesAfter"> = {},
): Promise<void> {
  return recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.rental,
    entityId: rentalId,
    action,
    ...values,
  });
}

/** The codes of the warnings a booking went ahead with, for the log (rule 19). */
function problemCodes(problems: readonly BookingProblem[]): string[] {
  return problems.map((problem) => problem.code);
}

/**
 * Holds the car unless another booking has it for some of that time. The
 * clash is looked up first so the Operator is told which booking is in the
 * way; the car row is locked, so the look-up cannot go stale before the hold.
 */
async function holdCarIfFree(
  tx: AnyTransaction,
  operatorId: string,
  rental: Pick<Rental, "id" | "vehicleId" | "plannedStart" | "plannedEnd">,
): Promise<BookingClash | null> {
  const span = { start: rental.plannedStart, end: rental.plannedEnd };
  const clash = await findBookingClash(tx, operatorId, rental.vehicleId, span);
  if (clash) {
    return clash;
  }
  await holdCar(tx, operatorId, { vehicleId: rental.vehicleId, rentalId: rental.id, ...span });
  return null;
}

/** Thrown inside the transaction so nothing of the booking is kept. */
class CarTakenError extends Error {
  constructor(readonly clash: BookingClash) {
    super("The car is already booked for some of that time.");
  }
}

/**
 * Runs a booking's writes; if the car turns out to be taken, by the
 * look-up or by the database's own rule in a race, nothing is kept.
 */
async function bookingTransaction(
  database: AnyDatabase,
  operatorId: string,
  write: (tx: AnyTransaction) => Promise<BookingResult>,
): Promise<BookingResult> {
  try {
    return await withTenant(database, operatorId, write);
  } catch (error) {
    if (error instanceof CarTakenError) {
      return { status: "car_taken", clash: error.clash };
    }
    if (isCarAlreadyHeld(error)) {
      return { status: "car_taken", clash: null };
    }
    throw error;
  }
}

/**
 * Adds a rental to the signed-in User's Operator, as a draft (car not
 * held) or a booking (car held for its planned dates). The Operator's
 * settings are copied on (rule 14) and the first weekly rate recorded from
 * the start date. A booking problem refuses it; a handover problem is
 * allowed and logged.
 */
export async function createRental(
  database: AnyDatabase,
  actor: ActingUser,
  input: RentalInput,
  status: NewRentalStatus,
  clock: RentalClock,
): Promise<BookingResult> {
  return bookingTransaction(database, actor.operatorId, async (tx) => {
    const parties = await lockBookingParties(tx, actor.operatorId, input);
    if (typeof parties === "string") {
      return { status: parties };
    }
    const snapshot = await snapshotOperatorSettings(tx, actor.operatorId);
    const span = { start: input.plannedStart, end: input.plannedEnd };
    const problems = await findBookingProblems(
      tx,
      parties,
      { ...span, ...clock },
      snapshot.settings,
    );
    if (isBookingRefused(problems)) {
      return { status: "refused", problems };
    }
    const { weeklyRateCents, chargeWeekday, ...details } = input;
    const values = {
      ...details,
      status,
      chargeWeekday:
        chargeWeekday ??
        chargeWeekdayFor(input.plannedStart, clock.timeZone, snapshot.settings.fixedChargeWeekday),
    };
    const [created] = await tx
      .insert(rentals)
      .values({
        ...values,
        operatorId: actor.operatorId,
        settingsSnapshot: { ...snapshot.settings },
        settingsVersion: snapshot.version,
      })
      .returning();
    if (!created) {
      throw new Error("The rental was not saved.");
    }
    await tx.insert(rentalRates).values({
      operatorId: actor.operatorId,
      rentalId: created.id,
      weeklyRateCents,
      appliesFrom: todayInTimeZone(input.plannedStart, clock.timeZone),
    });
    if (status === "booked") {
      const clash = await holdCarIfFree(tx, actor.operatorId, created);
      if (clash) {
        throw new CarTakenError(clash);
      }
    }
    await logRentalActivity(tx, actor, created.id, ACTIVITY_ACTIONS.created, {
      valuesAfter: {
        ...withholdFields<Rental>(values, PRIVATE_RENTAL_FIELDS),
        weeklyRateCents,
        settingsVersion: snapshot.version,
        warnings: problemCodes(problems),
      },
    });
    return { status: "saved", rentalId: created.id, problems };
  });
}

async function lockRental(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<Rental | undefined> {
  const [rental] = await tx
    .select()
    .from(rentals)
    .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)))
    .for("update");
  return rental;
}

/** Turns a draft into a booking: the checks run again with today's details, then the car is held. */
export async function bookRental(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  clock: RentalClock,
): Promise<BookingResult> {
  return bookingTransaction(database, actor.operatorId, async (tx) => {
    const rental = await lockRental(tx, actor.operatorId, rentalId);
    if (!rental) {
      return { status: "not_found" };
    }
    if (rental.status !== "draft") {
      return { status: "not_allowed" };
    }
    const parties = await lockBookingParties(tx, actor.operatorId, rental);
    if (typeof parties === "string") {
      return { status: parties };
    }
    // The rules the draft was made under (rule 14), not today's settings.
    const settings = readSettings(operatorSettingsSchema, rental.settingsSnapshot);
    const span = { start: rental.plannedStart, end: rental.plannedEnd };
    const problems = await findBookingProblems(tx, parties, { ...span, ...clock }, settings);
    if (isBookingRefused(problems)) {
      return { status: "refused", problems };
    }
    const clash = await holdCarIfFree(tx, actor.operatorId, rental);
    if (clash) {
      return { status: "car_taken", clash };
    }
    await tx.update(rentals).set({ status: "booked" }).where(eq(rentals.id, rental.id));
    await logRentalActivity(tx, actor, rental.id, ACTIVITY_ACTIONS.statusChanged, {
      valuesBefore: { status: rental.status },
      valuesAfter: { status: "booked", warnings: problemCodes(problems) },
    });
    return { status: "saved", rentalId: rental.id, problems };
  });
}

export type CancelRentalResult = "cancelled" | "not_found" | "not_allowed";

/** Cancels a draft or a booking, letting the car go. The reason stays out of the log. */
export async function cancelRental(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  input: CancelRentalInput,
  now: Date,
): Promise<CancelRentalResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const rental = await lockRental(tx, actor.operatorId, rentalId);
    if (!rental) {
      return "not_found";
    }
    if (rental.status !== "draft" && rental.status !== "booked") {
      return "not_allowed";
    }
    await releaseCarHolds(tx, actor.operatorId, rental.id, now);
    // Nobody should sign the contract of a rental that is not going ahead.
    await cancelLiveLinks(tx, actor, rental.renterId, now, { rentalId: rental.id });
    await tx
      .update(rentals)
      .set({ status: "cancelled", cancelledAt: now, cancellationReason: input.reason })
      .where(eq(rentals.id, rental.id));
    await logRentalActivity(tx, actor, rental.id, ACTIVITY_ACTIONS.statusChanged, {
      valuesBefore: { status: rental.status },
      valuesAfter: withholdFields<Rental>(
        { status: "cancelled", cancellationReason: input.reason },
        PRIVATE_RENTAL_FIELDS,
      ),
    });
    return "cancelled";
  });
}
