import {
  blockAt,
  blocksBetween,
  blockRateChangeProblem,
  blockStartsAt,
  canChangeEnd,
  canChangeRate,
  DAYS_PER_WEEK,
  endChangeProblem,
  isLongTermBooking,
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
  type RentModel,
  type RentalType,
  changeSigningProblem,
  isRateChangeOutOfTime,
  type ChangeSigningProblem,
  firstWeekAfterNotice,
  isRateRise,
  RATE_RISE_NOTICE_TEXT,
  signedRateChangeStartBlock,
} from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
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
import { ROW_LOCK } from "@fleetapp/db/row-lock";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { usableMandateOf } from "../debits/debit-queries";
import { cancelLiveLinks } from "../renter-links/cancel-links";
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
  handedOverAt: Date | null;
  rentModel: RentModel;
  isLongTerm: boolean | null;
  graceMinutes: number | null;
  longTermMinimumDays: number | null;
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
      handedOverAt: rentals.handedOverAt,
      rentModel: rentals.rentModel,
      isLongTerm: rentals.isLongTerm,
      graceMinutes: rentals.graceMinutes,
      longTermMinimumDays: rentals.longTermMinimumDays,
    })
    .from(rentals)
    .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)))
    .for(ROW_LOCK);
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
  | {
      status:
        | EndChangeProblem
        | "not_found"
        | "not_changeable"
        | "return_under_way"
        | "short_hire_ongoing";
    };

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
  // A shorter hold frees time, so only a longer one can clash (review A6-2).
  const isGrowing = newEnd === null || rental.plannedEnd === null || newEnd > rental.plannedEnd;
  const clash = isGrowing
    ? await findBookingClash(
        tx,
        operatorId,
        rental.vehicleId,
        { start: rental.plannedEnd ?? rental.plannedStart, end: newEnd },
        rental.id,
      )
    : null;
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
/**
 * A block rental's rent terms after a new end (review of batch 1). Before
 * the handover nothing is charged yet, so the booked days and long-term or
 * short hire follow the new end. Once the car is out they stay as booked,
 * since rent is already charged on them; a short hire then can't be made
 * ongoing (it would be charged by the day for good), so that is refused.
 */
export function rentTermsAfterEndChange(
  rental: Pick<
    LockedRental,
    | "rentModel"
    | "handedOverAt"
    | "plannedStart"
    | "isLongTerm"
    | "graceMinutes"
    | "longTermMinimumDays"
  >,
  newEnd: Date | null,
):
  | { bookedBlocks: number | null; isLongTerm: boolean }
  | Record<string, never>
  | "short_hire_ongoing" {
  if (rental.rentModel !== "blocks") {
    return {};
  }
  if (rental.handedOverAt === null) {
    const bookedBlocks = newEnd
      ? blocksBetween(rental.plannedStart, newEnd, rental.graceMinutes ?? 0)
      : null;
    return {
      bookedBlocks,
      isLongTerm: isLongTermBooking(bookedBlocks, rental.longTermMinimumDays ?? DAYS_PER_WEEK),
    };
  }
  return newEnd === null && rental.isLongTerm === false ? "short_hire_ongoing" : {};
}

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
    const terms = rentTermsAfterEndChange(rental, request.newEnd);
    if (terms === "short_hire_ongoing") {
      return { status: terms };
    }
    const { ongoingNoticeDays } = readSettings(operatorSettingsSchema, rental.settingsSnapshot);
    const daysShort = request.newEnd
      ? noticeDaysShort(request.newEnd, rental, clock, ongoingNoticeDays)
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
      .set({ plannedEnd: request.newEnd, type: typeAfter, ...terms, updatedAt: clock.now })
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
    await cancelReplacedChangeLinks(tx, actor, rental.id, change!.id, clock.now);
    return { status: "changed", changeId: change!.id, noticeDaysShort: daysShort };
  });
}

/**
 * A new end replaces every earlier end change: their form links stop, so a
 * Renter can't sign an end the rental no longer has (review A3-12).
 */
async function cancelReplacedChangeLinks(
  tx: AnyTransaction,
  actor: ActingUser,
  rentalId: string,
  newChangeId: string,
  now: Date,
): Promise<void> {
  const replaced = await tx
    .select({ id: rentalChanges.id })
    .from(rentalChanges)
    .where(
      and(
        eq(rentalChanges.operatorId, actor.operatorId),
        eq(rentalChanges.rentalId, rentalId),
        inArray(rentalChanges.kind, ["end_date", "make_ongoing"]),
        ne(rentalChanges.id, newChangeId),
      ),
    );
  for (const change of replaced) {
    await cancelChangeLinkIn(tx, actor, rentalId, change.id, now);
  }
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
    const isNoticeNeeded = await hasUsableMandate(tx, actor.operatorId, rental.id);
    const problem = blockRateChangeProblem(
      rate.terms,
      request,
      blockAt(rate.handedOverAt, clock.now),
      isNoticeNeeded ? firstWeekAfterNotice(rate.handedOverAt, clock.now) : null,
    );
    if (problem) {
      return { status: problem };
    }
    await withdrawOutOfTimeRateChanges(tx, actor, rental, clock.now);
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

/**
 * The change, locked; null if it is not this business's. Locked FOR UPDATE,
 * unlike other rows ("Lock order", lock modes): signing it writes its
 * document id, a unique key, which takes that lock anyway, so it is taken
 * here at the start rather than raised to halfway through.
 */
export async function lockChange(
  tx: AnyTransaction,
  operatorId: string,
  changeId: string,
): Promise<RentalChange | null> {
  const [change] = await tx
    .select()
    .from(rentalChanges)
    .where(and(eq(rentalChanges.id, changeId), eq(rentalChanges.operatorId, operatorId)))
    // eslint-disable-next-line no-restricted-syntax -- a unique key is written: see above.
    .for("update");
  return change ?? null;
}

/**
 * A rate change still waiting after its rent week began can never be
 * signed (review A3-1): it is withdrawn by the system, logged, so it no
 * longer blocks the next one, and its link stops.
 */
async function withdrawOutOfTimeRateChanges(
  tx: AnyTransaction,
  actor: ActingUser,
  rental: { id: string; status: RentalStatus; handedOverAt: Date | null },
  now: Date,
): Promise<void> {
  const waiting = await tx
    .select()
    .from(rentalChanges)
    .where(
      and(
        eq(rentalChanges.operatorId, actor.operatorId),
        eq(rentalChanges.rentalId, rental.id),
        eq(rentalChanges.status, "waiting_for_signature"),
      ),
    )
    .for(ROW_LOCK);
  for (const change of waiting.filter((candidate) =>
    isRateChangeOutOfTime(candidate, rental, now),
  )) {
    await tx
      .update(rentalChanges)
      .set({ status: "withdrawn", withdrawnAt: now })
      .where(eq(rentalChanges.id, change.id));
    await recordActivity(tx, {
      operatorId: actor.operatorId,
      actor: { type: "system", id: null },
      entityType: ACTIVITY_ENTITY_TYPES.rentalChange,
      entityId: change.id,
      action: ACTIVITY_ACTIONS.withdrawn,
      valuesAfter: { rentalId: rental.id, reason: "not_signed_in_time" },
    });
    await cancelChangeLinkIn(tx, actor, rental.id, change.id, now);
  }
}

/** Stops one change's form link inside the caller's transaction. */
async function cancelChangeLinkIn(
  tx: AnyTransaction,
  actor: ActingUser,
  rentalId: string,
  changeId: string,
  now: Date,
): Promise<void> {
  const [rental] = await tx
    .select({ renterId: rentals.renterId })
    .from(rentals)
    .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, actor.operatorId)));
  if (rental) {
    await cancelLiveLinks(tx, actor, rental.renterId, now, {
      rentalId,
      purpose: "sign_change",
      rentalChangeId: changeId,
    });
  }
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
  /** For a rate change, the rent week it starts from as signed (moved by the notice, decision 3). */
  signed: { documentId: string; at: Date; rateStartBlock?: number | null },
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
    const appliesFromBlock = signed.rateStartBlock ?? change.appliesFromBlock;
    await addSignedRate(tx, operatorId, { ...change, appliesFromBlock }, change.rateAfterCents);
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
 * Why the change can't be sent or signed now, from the shared rules
 * (review A3-1, A3-12, A3-15), with the rental's other changes read in the
 * same transaction.
 */
export async function changeSigningProblemNow(
  tx: AnyTransaction,
  operatorId: string,
  change: RentalChange,
  rental: { status: RentalStatus; handedOverAt: Date | null },
  now: Date,
): Promise<ChangeSigningProblem | null> {
  const others = await tx
    .select({
      id: rentalChanges.id,
      kind: rentalChanges.kind,
      status: rentalChanges.status,
      createdAt: rentalChanges.createdAt,
    })
    .from(rentalChanges)
    .where(
      and(eq(rentalChanges.operatorId, operatorId), eq(rentalChanges.rentalId, change.rentalId)),
    );
  const isStartMovedBySigning = await isRiseNoticedNow(tx, operatorId, change);
  return changeSigningProblem(change, { ...rental, isStartMovedBySigning }, others, now);
}

/** Whether the rental's Renter pays by a working direct debit now. */
async function hasUsableMandate(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<boolean> {
  const [rental] = await tx
    .select({ renterId: rentals.renterId })
    .from(rentals)
    .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)));
  return rental ? (await usableMandateOf(tx, operatorId, rental.renterId)) !== null : false;
}

/**
 * Whether a rate change waits for the 30 days' notice (slice 5, decision
 * 3): a rise, for a Renter paying by direct debit now. A Renter who sets one
 * up after signing keeps the change as signed; a fall starts as proposed.
 */
export async function isRiseNoticedNow(
  tx: AnyTransaction,
  operatorId: string,
  change: Pick<RentalChange, "kind" | "rentalId" | "rateBeforeCents" | "rateAfterCents">,
): Promise<boolean> {
  const isRise =
    change.kind === "weekly_rate" &&
    change.rateAfterCents !== null &&
    isRateRise(change.rateBeforeCents, change.rateAfterCents);
  return isRise && (await hasUsableMandate(tx, operatorId, change.rentalId));
}

/**
 * The rent week a rate change starts from if signed at `signedAt`: as
 * proposed, or for a noticed rise the first week starting 30 days after
 * signing, if later. Null for a change that is not a block rate change.
 */
export async function signedRateStartOf(
  tx: AnyTransaction,
  operatorId: string,
  change: RentalChange,
  signedAt: Date,
): Promise<{ block: number; startsAt: Date } | null> {
  const [rental] = await tx
    .select({ handedOverAt: rentals.handedOverAt })
    .from(rentals)
    .where(and(eq(rentals.id, change.rentalId), eq(rentals.operatorId, operatorId)));
  if (change.kind !== "weekly_rate" || change.appliesFromBlock === null || !rental?.handedOverAt) {
    return null;
  }
  const block = signedRateChangeStartBlock({
    handedOverAt: rental.handedOverAt,
    proposedFromBlock: change.appliesFromBlock,
    signedAt,
    needsNotice: await isRiseNoticedNow(tx, operatorId, change),
  });
  return { block, startsAt: blockStartsAt(rental.handedOverAt, block) };
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
  /** A rise for a direct-debit Renter: its start may move with the notice, and says so. */
  isRiseNoticed = false,
): ChangeFields {
  const rate = change.rateAfterCents === null ? null : formatCents(change.rateAfterCents);
  const startText = rateChangeStartText(change, handedOverAt, timeZone);
  const rateFrom =
    startText && isRiseNoticed ? `${startText}, ${RATE_RISE_NOTICE_TEXT}` : startText;
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
