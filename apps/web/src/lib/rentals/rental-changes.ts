import {
  blockAt,
  blockRateChangeProblem,
  blockStartsAt,
  canChangeEnd,
  canChangeRate,
  DAYS_PER_WEEK,
  endChangeProblem,
  isBlockRateChangeSignable,
  rateForBlock,
  formatCalendarDate,
  formatCents,
  formatDateTimeInTimeZone,
  noticeDaysShort,
  operatorSettingsSchema,
  readSettings,
  RENTAL_TYPE_LABELS,
  type BlockRateChangeProblem,
  type BlockRentTerms,
  type EndChangeProblem,
  type RentalStatus,
  type RentalType,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  carHolds,
  rentalChanges,
  rentalRates,
  rentals,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNull, sql } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { isChecklistUnderWay } from "../handover/handover-records";
import type { ChangeFields } from "../contracts/contract-data";
import { loadBlockRates } from "./block-rates";
import { findBookingClash, isCarAlreadyHeld, type BookingClash } from "./car-holds";
import type { RentalClock } from "./rental-records";

export type RentalChange = typeof rentalChanges.$inferSelect;

interface LockedRental {
  id: string;
  vehicleId: string;
  status: RentalStatus;
  type: RentalType;
  plannedStart: Date;
  plannedEnd: Date | null;
  settingsSnapshot: Record<string, unknown>;
}

/** The rental, locked for a change; null if it is not this business's. */
async function lockRental(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<LockedRental | null> {
  const [rental] = await tx
    .select({
      id: rentals.id,
      vehicleId: rentals.vehicleId,
      status: rentals.status,
      type: rentals.type,
      plannedStart: rentals.plannedStart,
      plannedEnd: rentals.plannedEnd,
      settingsSnapshot: rentals.settingsSnapshot,
    })
    .from(rentals)
    .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)))
    .for("update");
  return rental ?? null;
}

/** A return (or a swap's) under way is finishing the car's time: terms wait until it is done or cancelled. */
function isReturnUnderWay(tx: AnyTransaction, operatorId: string, rentalId: string) {
  return isChecklistUnderWay(tx, operatorId, rentalId, "return");
}

export type EndChangeResult =
  | { status: "changed"; changeId: string; noticeDaysShort: number }
  /** The booking in the way, or null when the database refused a booking made at the same moment. */
  | { status: "clash"; clash: BookingClash | null }
  | { status: EndChangeProblem | "not_found" | "not_changeable" | "return_under_way" };

/** Thrown inside the transaction when the database's no-overlap rule refuses the longer hold. */
class HoldClashError extends Error {
  constructor(readonly clash: BookingClash) {
    super("Another booking holds the car for part of the new time.");
  }
}

/** The new end, checked against the rental's state and terms; null when it can go ahead. */
async function endRefusal(
  tx: AnyTransaction,
  operatorId: string,
  rental: LockedRental | null,
  newEnd: Date | null,
  now: Date,
): Promise<Exclude<EndChangeResult, { status: "changed" }> | null> {
  if (!rental) {
    return { status: "not_found" };
  }
  if (!canChangeEnd(rental.status)) {
    return { status: "not_changeable" };
  }
  if (await isReturnUnderWay(tx, operatorId, rental.id)) {
    return { status: "return_under_way" };
  }
  if (newEnd === null) {
    return rental.type === "ongoing" ? { status: "unchanged" } : null;
  }
  const problem = endChangeProblem(newEnd, rental, now);
  return problem ? { status: problem } : null;
}

/** Moves the rental's live hold to end at `newEnd` (open-ended when null), refusing a clash. */
async function moveHoldEnd(
  tx: AnyTransaction,
  operatorId: string,
  rental: LockedRental,
  newEnd: Date | null,
): Promise<void> {
  const clash = await findBookingClash(
    tx,
    operatorId,
    rental.vehicleId,
    { start: rental.plannedEnd ?? rental.plannedStart, end: newEnd },
    rental.id,
  );
  if (clash) {
    throw new HoldClashError(clash);
  }
  await tx
    .update(carHolds)
    .set({
      heldDuring: sql`tstzrange(lower(${carHolds.heldDuring}), ${newEnd?.toISOString() ?? null}::timestamptz, '[)')`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(carHolds.operatorId, operatorId),
        eq(carHolds.rentalId, rental.id),
        isNull(carHolds.releasedAt),
      ),
    );
}

/**
 * A new end for the rental, or (`newEnd` null) no end: made ongoing. Agreed
 * with the Renter, so it takes effect at once: the rental, its car's hold
 * and the change record move together (rules 14, 18, 19). An ongoing
 * rental given an end with less notice than its settings ask is allowed,
 * marked short notice and logged.
 */
export async function changeRentalEnd(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  request: { newEnd: Date | null; reason: string },
  clock: RentalClock,
): Promise<EndChangeResult> {
  return withTenant(database, actor.operatorId, async (tx): Promise<EndChangeResult> => {
    const rental = await lockRental(tx, actor.operatorId, rentalId);
    const refusal = await endRefusal(tx, actor.operatorId, rental, request.newEnd, clock.now);
    if (refusal || !rental) {
      return refusal ?? { status: "not_found" };
    }
    const { ongoingNoticeDays } = readSettings(operatorSettingsSchema, rental.settingsSnapshot);
    const daysShort = request.newEnd
      ? noticeDaysShort(request.newEnd, rental, clock.now, ongoingNoticeDays)
      : 0;
    try {
      await tx.transaction(async (savepoint) => {
        await moveHoldEnd(savepoint, actor.operatorId, rental, request.newEnd);
      });
    } catch (error) {
      if (error instanceof HoldClashError) {
        return { status: "clash", clash: error.clash };
      }
      if (isCarAlreadyHeld(error)) {
        return { status: "clash", clash: null };
      }
      throw error;
    }
    const typeAfter: RentalType = request.newEnd ? "fixed_term" : "ongoing";
    await tx
      .update(rentals)
      .set({ plannedEnd: request.newEnd, type: typeAfter, updatedAt: clock.now })
      .where(eq(rentals.id, rental.id));
    const [change] = await tx
      .insert(rentalChanges)
      .values({
        operatorId: actor.operatorId,
        rentalId: rental.id,
        kind: request.newEnd ? "end_date" : "make_ongoing",
        status: "applied",
        appliedAt: clock.now,
        typeBefore: rental.type,
        typeAfter,
        endBefore: rental.plannedEnd,
        endAfter: request.newEnd,
        isShortNotice: daysShort > 0,
        reason: request.reason,
        createdByUserId: actor.userId,
        createdAt: clock.now,
      })
      .returning({ id: rentalChanges.id });
    await logChange(tx, actor, change!.id, ACTIVITY_ACTIONS.created, {
      rentalId: rental.id,
      kind: request.newEnd ? "end_date" : "make_ongoing",
      endAfter: request.newEnd?.toISOString() ?? null,
      isShortNotice: daysShort > 0,
    });
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.rental,
      entityId: rental.id,
      action: ACTIVITY_ACTIONS.updated,
      valuesBefore: { type: rental.type, plannedEnd: rental.plannedEnd?.toISOString() ?? null },
      valuesAfter: { type: typeAfter, plannedEnd: request.newEnd?.toISOString() ?? null },
    });
    return { status: "changed", changeId: change!.id, noticeDaysShort: daysShort };
  });
}

function logChange(
  tx: AnyTransaction,
  actor: ActingUser,
  changeId: string,
  action: (typeof ACTIVITY_ACTIONS)[keyof typeof ACTIVITY_ACTIONS],
  valuesAfter: Record<string, unknown>,
): Promise<void> {
  return recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.rentalChange,
    entityId: changeId,
    action,
    valuesAfter,
  });
}

export type RateChangeResult =
  | { status: "waiting"; changeId: string }
  | {
      status:
        | BlockRateChangeProblem
        | "not_found"
        | "not_changeable"
        | "one_waiting"
        | "return_under_way";
    };

/** A long-term block rental's terms as far as a rate change goes, or null if it is not one. */
async function rateTermsOf(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<{ terms: BlockRentTerms; handedOverAt: Date } | null> {
  const [row] = await tx
    .select({
      handedOverAt: rentals.handedOverAt,
      isLongTerm: rentals.isLongTerm,
      bookedBlocks: rentals.bookedBlocks,
    })
    .from(rentals)
    .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)));
  if (!row?.handedOverAt || row.isLongTerm === null) {
    return null;
  }
  const rates = await loadBlockRates(tx, operatorId, rentalId);
  const terms: BlockRentTerms = {
    isLongTerm: row.isLongTerm,
    graceMinutes: 0,
    longTermMinimumDays: DAYS_PER_WEEK,
    bookedBlocks: row.bookedBlocks ?? 0,
    rates,
    isDailyRateWaived: false,
  };
  return { terms, handedOverAt: row.handedOverAt };
}

/** A rate's weekly price, or seven of its daily rate when it has none. */
function weeklyPriceOf(rate: { weeklyRateCents: number | null; dailyRateCents: number }): number {
  return rate.weeklyRateCents ?? rate.dailyRateCents * DAYS_PER_WEEK;
}

/**
 * A new weekly price from a rent week's start (docs/plans/review-fixes-batch-1.md),
 * waiting for the Renter's signature on the change-of-terms form: it is not
 * a rate until they sign (consumer law: the price is not changed by one side
 * alone). Long-term rentals only, from a week after the one running, never a
 * week that already has a signed rate, and compared with the rate that week
 * would have (review G2-5). One can wait at a time.
 */
export async function proposeRateChange(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  request: { weeklyRateCents: number; fromBlock: number; reason: string },
  clock: RentalClock,
): Promise<RateChangeResult> {
  return withTenant(database, actor.operatorId, async (tx): Promise<RateChangeResult> => {
    const rental = await lockRental(tx, actor.operatorId, rentalId);
    if (!rental) {
      return { status: "not_found" };
    }
    if (!canChangeRate(rental.status)) {
      return { status: "not_changeable" };
    }
    if (await isReturnUnderWay(tx, actor.operatorId, rental.id)) {
      return { status: "return_under_way" };
    }
    const rate = await rateTermsOf(tx, actor.operatorId, rental.id);
    if (!rate) {
      return { status: "not_long_term" };
    }
    const problem = blockRateChangeProblem(
      rate.terms,
      request,
      blockAt(rate.handedOverAt, clock.now),
    );
    if (problem) {
      return { status: problem };
    }
    const rateBeforeCents = weeklyPriceOf(rateForBlock(rate.terms.rates, request.fromBlock));
    const [change] = await tx
      .insert(rentalChanges)
      .values({
        operatorId: actor.operatorId,
        rentalId: rental.id,
        kind: "weekly_rate",
        status: "waiting_for_signature",
        rateBeforeCents,
        rateAfterCents: request.weeklyRateCents,
        appliesFromBlock: request.fromBlock,
        reason: request.reason,
        createdByUserId: actor.userId,
        createdAt: clock.now,
      })
      .onConflictDoNothing()
      .returning({ id: rentalChanges.id });
    if (!change) {
      return { status: "one_waiting" };
    }
    await logChange(tx, actor, change.id, ACTIVITY_ACTIONS.created, {
      rentalId: rental.id,
      kind: "weekly_rate",
      rateAfterCents: request.weeklyRateCents,
      appliesFromBlock: request.fromBlock,
    });
    return { status: "waiting", changeId: change.id };
  });
}

/** The change, locked; null if it is not this business's. */
export async function lockChange(
  tx: AnyTransaction,
  operatorId: string,
  changeId: string,
): Promise<RentalChange | null> {
  const [change] = await tx
    .select()
    .from(rentalChanges)
    .where(and(eq(rentalChanges.id, changeId), eq(rentalChanges.operatorId, operatorId)))
    .for("update");
  return change ?? null;
}

/** Withdraws a change still waiting for the Renter's signature; its link is cancelled by the caller. */
export async function withdrawWaitingChange(
  tx: AnyTransaction,
  actor: ActingUser,
  changeId: string,
  now: Date,
): Promise<RentalChange | null> {
  const change = await lockChange(tx, actor.operatorId, changeId);
  if (change?.status !== "waiting_for_signature") {
    return null;
  }
  await tx
    .update(rentalChanges)
    .set({ status: "withdrawn", withdrawnAt: now })
    .where(eq(rentalChanges.id, changeId));
  await logChange(tx, actor, changeId, ACTIVITY_ACTIONS.withdrawn, { rentalId: change.rentalId });
  return change;
}

/**
 * Inside the signing's own transaction: the form is kept on the change, and
 * a waiting rate change takes effect, as a new rate row from its day.
 */
export async function recordChangeSigned(
  tx: AnyTransaction,
  operatorId: string,
  change: RentalChange,
  signed: { documentId: string; at: Date },
): Promise<void> {
  const isWaiting = change.status === "waiting_for_signature";
  await tx
    .update(rentalChanges)
    .set({
      documentId: signed.documentId,
      ...(isWaiting ? { status: "applied" as const, appliedAt: signed.at } : {}),
    })
    .where(eq(rentalChanges.id, change.id));
  if (isWaiting && change.kind === "weekly_rate" && change.rateAfterCents) {
    await addSignedRate(tx, operatorId, change, change.rateAfterCents);
  }
}

/**
 * The signed rate as a new rate row: from its rent week, keeping the daily
 * rate in force then; a weekday-era change keeps its date.
 */
async function addSignedRate(
  tx: AnyTransaction,
  operatorId: string,
  change: RentalChange,
  weeklyRateCents: number,
): Promise<void> {
  if (change.appliesFromBlock === null) {
    await tx.insert(rentalRates).values({
      operatorId,
      rentalId: change.rentalId,
      weeklyRateCents,
      appliesFrom: change.appliesFrom,
    });
    return;
  }
  const rates = await loadBlockRates(tx, operatorId, change.rentalId);
  await tx.insert(rentalRates).values({
    operatorId,
    rentalId: change.rentalId,
    weeklyRateCents,
    dailyRateCents: rateForBlock(rates, change.appliesFromBlock).dailyRateCents,
    appliesFromBlock: change.appliesFromBlock,
  });
}

/**
 * Whether the change can still be signed: not withdrawn, not signed, its
 * rental not finished, and a rate change's rent week not yet begun (no
 * backdating, review A3-1).
 */
export function isChangeSignable(
  change: RentalChange,
  rental: { status: RentalStatus; handedOverAt: Date | null },
  now: Date,
): boolean {
  const isWeekStillAhead =
    change.appliesFromBlock === null ||
    rental.handedOverAt === null ||
    change.status !== "waiting_for_signature" ||
    isBlockRateChangeSignable(rental.handedOverAt, change.appliesFromBlock, now);
  return (
    change.status !== "withdrawn" &&
    change.documentId === null &&
    canChangeEnd(rental.status) &&
    isWeekStillAhead
  );
}

/** When a rate change starts, in words: its rent week's start on the business's clock, or its date. */
export function rateChangeStartText(
  change: Pick<RentalChange, "appliesFrom" | "appliesFromBlock">,
  handedOverAt: Date | null,
  timeZone: string,
): string | null {
  if (change.appliesFromBlock !== null && handedOverAt) {
    return formatDateTimeInTimeZone(blockStartsAt(handedOverAt, change.appliesFromBlock), timeZone);
  }
  return change.appliesFrom ? formatCalendarDate(change.appliesFrom) : null;
}

/** What the change-of-terms form's own fields say, on the business's clock (rule 10). */
export function changeFieldsOf(
  change: RentalChange,
  timeZone: string,
  handedOverAt: Date | null,
): ChangeFields {
  const rate = change.rateAfterCents === null ? null : formatCents(change.rateAfterCents);
  const rateFrom = rateChangeStartText(change, handedOverAt, timeZone);
  const newEnd = change.endAfter ? formatDateTimeInTimeZone(change.endAfter, timeZone) : null;
  return {
    changeSummary: changeSummaryText(change, { rate, rateFrom, newEnd }),
    changeReason: change.reason,
    changeNewRate: rate,
    changeRateFrom: rateFrom,
    changeNewEnd: newEnd,
  };
}

function changeSummaryText(
  change: RentalChange,
  words: { rate: string | null; rateFrom: string | null; newEnd: string | null },
): string {
  if (change.kind === "weekly_rate") {
    const before =
      change.rateBeforeCents === null ? "" : ` (was ${formatCents(change.rateBeforeCents)})`;
    return `The weekly rate becomes ${words.rate ?? ""}${before} from ${words.rateFrom ?? ""}.`;
  }
  if (change.kind === "make_ongoing") {
    return `The rental becomes ${RENTAL_TYPE_LABELS.ongoing.toLowerCase()}: it has no end date until notice is given.`;
  }
  return `The rental now ends on ${words.newEnd ?? ""}.`;
}
