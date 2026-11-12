import {
  instalmentShares,
  isNoticeDateReached,
  isRentWeekDebitable,
  ledgerBalanceCents,
  rentWeekCents,
  scheduledDebitCents,
  type PeriodLedgerLine,
} from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  debitItems,
  debitPlans,
  ledgerLines,
  payments,
  rentals,
} from "@fleetapp/db/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import {
  debitsResumedAt,
  pendingDebitCents,
  stripeCustomerOf,
  usableMandateOf,
} from "./debit-queries";

const SYSTEM_ACTOR = { type: "system", id: null } as const;

/** One part of what a debit takes: a charge line (or one instalment of a split). */
interface PlannedItem {
  ledgerLineId: string;
  instalment: number;
  amountCents: number;
}

type RentalLine = PeriodLedgerLine & { isCorrection: boolean };

async function rentalLines(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<RentalLine[]> {
  return tx
    .select({
      id: ledgerLines.id,
      kind: ledgerLines.kind,
      amountCents: ledgerLines.amountCents,
      reversesId: ledgerLines.reversesId,
      periodStartsAt: ledgerLines.periodStartsAt,
      isCorrection: ledgerLines.isCorrection,
    })
    .from(ledgerLines)
    .where(and(eq(ledgerLines.operatorId, operatorId), eq(ledgerLines.rentalId, rentalId)));
}

/** How many parts of each of the rental's charges are already in a debit. */
async function partsDebited(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({ lineId: debitItems.ledgerLineId, parts: sql<number>`count(*)`.mapWith(Number) })
    .from(debitItems)
    .where(and(eq(debitItems.operatorId, operatorId), eq(debitItems.rentalId, rentalId)))
    .groupBy(debitItems.ledgerLineId);
  return new Map(rows.map((row) => [row.lineId, row.parts]));
}

/** The rental's one-off charges planned for a debit whose notice date has come by `today`. */
async function noticedPlans(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
  today: string,
) {
  const plans = await tx
    .select({
      lineId: debitPlans.ledgerLineId,
      plan: debitPlans.plan,
      weeks: debitPlans.weeks,
      noticeDate: debitPlans.noticeDate,
    })
    .from(debitPlans)
    .where(and(eq(debitPlans.operatorId, operatorId), eq(debitPlans.rentalId, rentalId)));
  // No email, no debit, and never before its notice date (docs/plans/one-off-charge-notice.md).
  return plans.filter((plan) => isNoticeDateReached(plan.noticeDate, today));
}

/**
 * The one-off charges planned for the next weekly debit, and the next
 * instalment of each split, once their notice date has come: a charge
 * reversed before it is debited drops out (its reversal stands on the ledger).
 */
async function oneOffItemsDue(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
  lines: readonly RentalLine[],
  today: string,
): Promise<PlannedItem[]> {
  const plans = await noticedPlans(tx, operatorId, rentalId, today);
  const debited = await partsDebited(tx, operatorId, rentalId);
  const reversed = new Set(lines.flatMap((line) => (line.reversesId ? [line.reversesId] : [])));
  const amounts = new Map(lines.map((line) => [line.id, line.amountCents]));
  return plans.flatMap((plan): PlannedItem[] => {
    const amountCents = amounts.get(plan.lineId);
    const done = debited.get(plan.lineId) ?? 0;
    if (amountCents === undefined || reversed.has(plan.lineId)) {
      return [];
    }
    if (plan.plan === "next_debit" && done === 0) {
      return [{ ledgerLineId: plan.lineId, instalment: 1, amountCents }];
    }
    const shares =
      plan.plan === "split" && plan.weeks ? instalmentShares(amountCents, plan.weeks) : [];
    const next = shares[done];
    return next ? [{ ledgerLineId: plan.lineId, instalment: done + 1, amountCents: next }] : [];
  });
}

/** What the debit can take: what is planned, capped at what is owing on the rental less what is pending. */
async function cappedCents(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
  plannedCents: number,
  lines: readonly RentalLine[],
): Promise<number> {
  return scheduledDebitCents({
    plannedCents,
    owingCents: ledgerBalanceCents(lines),
    pendingCents: await pendingDebitCents(tx, operatorId, rentalId),
  });
}

/** The Renter's working direct debit, only if they are a customer on the business's Stripe account too. */
async function debitableMandateOf(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<{ id: string } | null> {
  const [mandate, customerId] = await Promise.all([
    usableMandateOf(tx, operatorId, renterId),
    stripeCustomerOf(tx, operatorId, renterId),
  ]);
  return mandate && customerId ? mandate : null;
}

/** A debit reserved before Stripe is asked, ready to send. */
export interface ReservedDebit {
  id: string;
  rentalId: string;
}

/**
 * Reserves the debit with its items: the payments row (pending, no Stripe
 * ID yet, the direct debit it will use) and what it was planned from. The
 * one-per-week rule refuses a second for the same week, so two runs can't
 * both reserve it (rule 20): then nothing is reserved here.
 */
async function insertDebit(
  tx: AnyTransaction,
  operatorId: string,
  debit: Omit<typeof payments.$inferInsert, "operatorId" | "method" | "status">,
  items: readonly PlannedItem[],
): Promise<ReservedDebit | null> {
  const [reserved] = await tx
    .insert(payments)
    .values({ ...debit, operatorId, method: "becs_debit", status: "pending" })
    .onConflictDoNothing()
    .returning({ id: payments.id, rentalId: payments.rentalId });
  if (!reserved) {
    return null;
  }
  const parts = items.filter((item) => item.amountCents > 0);
  if (parts.length > 0) {
    await tx.insert(debitItems).values(
      parts.map((item) => ({
        ...item,
        operatorId,
        rentalId: reserved.rentalId,
        paymentId: reserved.id,
      })),
    );
  }
  await recordActivity(tx, {
    operatorId,
    actor: SYSTEM_ACTOR,
    entityType: ACTIVITY_ENTITY_TYPES.payment,
    entityId: reserved.id,
    action: ACTIVITY_ACTIONS.created,
    valuesAfter: {
      rentalId: reserved.rentalId,
      purpose: debit.purpose,
      amountCents: debit.amountCents,
    },
  });
  return reserved;
}

/** The rental as the weekly debit reads it, under the lock the caller already holds. */
async function debitableRental(tx: AnyTransaction, operatorId: string, rentalId: string) {
  const [rental] = await tx
    .select({
      renterId: rentals.renterId,
      handedOverAt: rentals.handedOverAt,
      debitsPausedAt: rentals.debitsPausedAt,
    })
    .from(rentals)
    .where(
      and(
        eq(rentals.id, rentalId),
        eq(rentals.operatorId, operatorId),
        eq(rentals.status, "active"),
        eq(rentals.rentModel, "blocks"),
        eq(rentals.isLongTerm, true),
        isNotNull(rentals.handedOverAt),
      ),
    );
  return rental?.handedOverAt && !rental.debitsPausedAt
    ? { renterId: rental.renterId, handedOverAt: rental.handedOverAt }
    : null;
}

/**
 * The week's debit for one long-term rental that is out, with the rental
 * already locked by the caller: the rent week that started in the last 7
 * days (not the first, not one begun while paused) and has no debit yet,
 * plus the one-off charges due with it (their notice date come by `today`,
 * the business's day), capped at what is owing less what is pending,
 * skipped under 50c. Only the scheduled amount, never the whole balance
 * (design 06). Null when there is nothing to debit.
 */
export async function reserveWeeklyDebit(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
  clock: { now: Date; today: string },
): Promise<ReservedDebit | null> {
  const { now, today } = clock;
  const rental = await debitableRental(tx, operatorId, rentalId);
  const mandate = rental ? await debitableMandateOf(tx, operatorId, rental.renterId) : null;
  if (!rental || !mandate) {
    return null;
  }
  const lines = await rentalLines(tx, operatorId, rentalId);
  const resumedAt = await debitsResumedAt(tx, operatorId, rentalId);
  const week = lines.find(
    (line) =>
      line.kind === "charge" &&
      !line.isCorrection &&
      line.periodStartsAt !== null &&
      isRentWeekDebitable({
        weekStartsAt: line.periodStartsAt,
        handedOverAt: rental.handedOverAt,
        now,
        resumedAt,
      }),
  );
  if (!week?.periodStartsAt) {
    return null;
  }
  const rentItem = {
    ledgerLineId: week.id,
    instalment: 1,
    amountCents: rentWeekCents(lines, week.periodStartsAt),
  };
  const items = [rentItem, ...(await oneOffItemsDue(tx, operatorId, rentalId, lines, today))];
  const plannedCents = items.reduce((total, item) => total + item.amountCents, 0);
  const amountCents = await cappedCents(tx, operatorId, rentalId, plannedCents, lines);
  if (amountCents === 0) {
    return null;
  }
  return insertDebit(
    tx,
    operatorId,
    {
      renterId: rental.renterId,
      rentalId,
      purpose: "scheduled_debit",
      amountCents,
      mandateId: mandate.id,
      periodStartsAt: week.periodStartsAt,
      requestedAt: now,
    },
    items,
  );
}

/**
 * The rental's "Debit on [date]" charges whose day has come, each debited on
 * its own by the nightly run (never at once: docs/plans/one-off-charge-notice.md),
 * with the rental already locked by the caller: its amount, capped at what
 * is owing less what is pending. None when the Renter has no usable direct
 * debit; a charge reversed, already in a debit, or with nothing left to
 * take is left. The rental must not be paused (the caller checks).
 */
export async function reserveNoticedOwnDebits(
  tx: AnyTransaction,
  operatorId: string,
  rental: { id: string; renterId: string },
  clock: { now: Date; today: string },
): Promise<ReservedDebit[]> {
  const plans = (await noticedPlans(tx, operatorId, rental.id, clock.today)).filter(
    (plan) => plan.plan === "own_debit",
  );
  const mandate =
    plans.length > 0 ? await debitableMandateOf(tx, operatorId, rental.renterId) : null;
  if (!mandate) {
    return [];
  }
  const reserved: ReservedDebit[] = [];
  for (const plan of plans) {
    const debit = await reserveOwnDebit(tx, operatorId, rental, mandate, plan.lineId, clock.now);
    if (debit) {
      reserved.push(debit);
    }
  }
  return reserved;
}

/** One "Debit on [date]" charge reserved on its own, read afresh so the cap counts the ones before it. */
async function reserveOwnDebit(
  tx: AnyTransaction,
  operatorId: string,
  rental: { id: string; renterId: string },
  mandate: { id: string },
  ledgerLineId: string,
  now: Date,
): Promise<ReservedDebit | null> {
  const lines = await rentalLines(tx, operatorId, rental.id);
  const charge = lines.find((line) => line.id === ledgerLineId && line.kind === "charge");
  const isReversed = lines.some((line) => line.reversesId === ledgerLineId);
  const isDebited = (await partsDebited(tx, operatorId, rental.id)).has(ledgerLineId);
  if (!charge || isReversed || isDebited) {
    return null;
  }
  const amountCents = await cappedCents(tx, operatorId, rental.id, charge.amountCents, lines);
  if (amountCents === 0) {
    return null;
  }
  return insertDebit(
    tx,
    operatorId,
    {
      renterId: rental.renterId,
      rentalId: rental.id,
      purpose: "one_off_debit",
      amountCents,
      mandateId: mandate.id,
      requestedAt: now,
    },
    [{ ledgerLineId, instalment: 1, amountCents: charge.amountCents }],
  );
}
