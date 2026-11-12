import {
  oneOffNoticeDate,
  operatorSettingsSchema,
  readSettings,
  todayInTimeZone,
  type DebitCollectionPlan,
  type RentalStatus,
} from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { debitItems, debitPlans, ledgerLines, rentals } from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, sql } from "drizzle-orm";

import { collectionChoicesFor, isStripeReadyFor } from "./debit-plans";
import { loadRentalDebits, type RentalDebitRow } from "./debit-queries";

/** A one-off charge's plan, as the rental's Money card shows and changes it. */
export interface ChargePlanRow {
  ledgerLineId: string;
  plan: DebitCollectionPlan;
  weeks: number | null;
  /** Parts already in a debit: none means it can still be changed. */
  partsDebited: number;
  /** The first day it may be debited; none until its invoice is emailed with the debit stated. */
  noticeDate: string | null;
  /** The charge itself, as the Renter reads it. */
  description: string;
  amountCents: number;
  /** Reversed: no longer owed, so never debited. */
  isReversed: boolean;
}

/** A planned charge still to be debited (in part, for a split): planned for a debit, not reversed. */
export function isWaitingForDebit(plan: ChargePlanRow): boolean {
  const parts = plan.plan === "split" ? (plan.weeks ?? 0) : 1;
  return plan.plan !== "not_debited" && !plan.isReversed && plan.partsDebited < parts;
}

/** The day a one-off charge added now could first be debited, and today, on the business's clock. */
export interface NoticeClock {
  today: string;
  /** Today plus the rental's notice period (its settings copy, rule 14). */
  expectedNoticeDate: string;
}

/** The rental's notice clock, from its settings copy. */
function noticeClockOf(
  settingsSnapshot: Record<string, unknown>,
  clock: { now: Date; timeZone: string },
): NoticeClock {
  const { oneOffNoticeDays } = readSettings(operatorSettingsSchema, settingsSnapshot);
  return {
    today: todayInTimeZone(clock.now, clock.timeZone),
    expectedNoticeDate: oneOffNoticeDate(clock.now, clock.timeZone, oneOffNoticeDays),
  };
}

/** What the rental's page shows about its debits (docs/plans/phase-4-slice-5.md, Screens). */
export interface RentalDebitState {
  debits: RentalDebitRow[];
  /** The ways a new one-off charge can be collected; none without a working direct debit. */
  choices: DebitCollectionPlan[];
  /** The rental's default for a one-off charge, from its settings copy (rule 14). */
  defaultCollection: DebitCollectionPlan;
  isPaused: boolean;
  plans: ChargePlanRow[];
  pending: { cents: number; since: Date } | null;
  lastCleared: RentalDebitRow | null;
  notice: NoticeClock;
}

export async function loadRentalDebitState(
  database: AnyDatabase,
  operatorId: string,
  rental: {
    id: string;
    renterId: string;
    status: RentalStatus;
    settingsSnapshot: Record<string, unknown>;
  },
  clock: { now: Date; timeZone: string },
): Promise<RentalDebitState> {
  const isStripeReady = await isStripeReadyFor(database, operatorId);
  const [debits, inTenant] = await Promise.all([
    loadRentalDebits(database, operatorId, rental.id),
    withTenant(database, operatorId, async (tx) => ({
      choices: await collectionChoicesFor(tx, operatorId, rental, isStripeReady),
      paused: await tx
        .select({ at: rentals.debitsPausedAt })
        .from(rentals)
        .where(and(eq(rentals.id, rental.id), eq(rentals.operatorId, operatorId))),
      plans: await tx
        .select({
          ledgerLineId: debitPlans.ledgerLineId,
          plan: debitPlans.plan,
          weeks: debitPlans.weeks,
          partsDebited: sql<number>`(select count(*) from ${debitItems}
            where ${qualified(debitItems.ledgerLineId)} = ${qualified(debitPlans.ledgerLineId)})`.mapWith(
            Number,
          ),
          noticeDate: debitPlans.noticeDate,
          description: ledgerLines.description,
          amountCents: ledgerLines.amountCents,
          isReversed: sql<boolean>`exists (select 1 from ${ledgerLines} reversal
            where reversal.reverses_id = ${qualified(debitPlans.ledgerLineId)})`,
        })
        .from(debitPlans)
        .innerJoin(
          ledgerLines,
          and(
            eq(ledgerLines.id, debitPlans.ledgerLineId),
            eq(ledgerLines.operatorId, debitPlans.operatorId),
          ),
        )
        .where(and(eq(debitPlans.operatorId, operatorId), eq(debitPlans.rentalId, rental.id))),
    })),
  ]);
  const pendingDebits = debits.filter((debit) => debit.status === "pending");
  const oldestPending = pendingDebits.at(-1);
  return {
    debits,
    choices: inTenant.choices,
    defaultCollection: readSettings(operatorSettingsSchema, rental.settingsSnapshot)
      .oneOffChargeCollection,
    isPaused: Boolean(inTenant.paused[0]?.at),
    plans: inTenant.plans,
    pending: oldestPending
      ? {
          cents: pendingDebits.reduce((total, debit) => total + debit.amountCents, 0),
          since: oldestPending.requestedAt,
        }
      : null,
    lastCleared:
      debits.find((debit) => debit.status === "succeeded" || debit.status === "refunded") ?? null,
    notice: noticeClockOf(rental.settingsSnapshot, clock),
  };
}

/**
 * The ways a new one-off charge on this rental can be collected, its
 * default, and the day it could first be debited (from a damage record).
 */
export async function loadCollectionChoices(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
  clock: { now: Date; timeZone: string },
): Promise<Pick<RentalDebitState, "choices" | "defaultCollection" | "notice">> {
  const isStripeReady = await isStripeReadyFor(database, operatorId);
  return withTenant(database, operatorId, async (tx) => {
    const [rental] = await tx
      .select({
        renterId: rentals.renterId,
        status: rentals.status,
        settingsSnapshot: rentals.settingsSnapshot,
      })
      .from(rentals)
      .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)));
    const snapshot = rental?.settingsSnapshot ?? {};
    const defaultCollection = readSettings(operatorSettingsSchema, snapshot).oneOffChargeCollection;
    return {
      choices: rental ? await collectionChoicesFor(tx, operatorId, rental, isStripeReady) : [],
      defaultCollection,
      notice: noticeClockOf(snapshot, clock),
    };
  });
}
