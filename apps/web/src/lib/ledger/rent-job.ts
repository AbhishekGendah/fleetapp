import {
  blockAt,
  blocksBetween,
  blockStartsAt,
  describeErrorForLog,
  formatDateTimeInTimeZone,
  gstForLine,
  isGstRegisteredOn,
  isRepricedAtDailyRate,
  MILLISECONDS_PER_DAY,
  rentLinesToAdd,
  todayInTimeZone,
  type BlockRate,
  type BlockRentTerms,
  type ChargedRentLine,
  type RentLineToAdd,
  type RentProgress,
} from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, ledgerLines, rentals } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { BillingDependencies } from "../billing/billing-context";
import { issuePendingDocumentsQuietly } from "../billing/billing-run";
import { findDueOperators, forEachOperator, type OperatorRun } from "../jobs/due-operators";
import { loadBlockRates } from "../rentals/block-rates";
import { builtInChargeType, type ChargeType } from "./charge-types";
import { loadOperatorGst, type OperatorGst } from "./operator-gst";

const SYSTEM_ACTOR = { type: "system", id: null } as const;
/**
 * A returned rental is looked at for this long after the return, so its
 * correction is added even if the run missed days around it.
 */
const RETURNED_LOOKBACK_DAYS = 60;

export interface RentAdded {
  charged: number;
  corrected: number;
}

const NOTHING_ADDED: RentAdded = { charged: 0, corrected: 0 };

/** What the run needs about one rental, read again under its lock. */
interface BlockRental {
  id: string;
  handedOverAt: Date;
  returnedAt: Date | null;
  isLongTerm: boolean;
  graceMinutes: number;
  longTermMinimumDays: number;
  bookedBlocks: number | null;
  dailyRateWaivedReason: string | null;
}

interface RentContext {
  operatorId: string;
  gst: OperatorGst;
  now: Date;
}

/** Locks the rental and reads it, so a return or signed change can't land halfway (review G2-1). */
async function lockBlockRental(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<BlockRental | null> {
  const [row] = await tx
    .select({
      id: rentals.id,
      handedOverAt: rentals.handedOverAt,
      returnedAt: rentals.returnedAt,
      isLongTerm: rentals.isLongTerm,
      graceMinutes: rentals.graceMinutes,
      longTermMinimumDays: rentals.longTermMinimumDays,
      bookedBlocks: rentals.bookedBlocks,
      dailyRateWaivedReason: rentals.dailyRateWaivedReason,
    })
    .from(rentals)
    .where(
      and(
        eq(rentals.operatorId, operatorId),
        eq(rentals.id, rentalId),
        eq(rentals.rentModel, "blocks"),
      ),
    )
    .for("update");
  if (!row?.handedOverAt || row.isLongTerm === null) {
    return null;
  }
  return {
    ...row,
    handedOverAt: row.handedOverAt,
    isLongTerm: row.isLongTerm,
    graceMinutes: row.graceMinutes ?? 0,
    longTermMinimumDays: row.longTermMinimumDays ?? 1,
  };
}

/** The rental's block rent lines so far, each marked if the business has reversed it. */
async function loadChargedRentLines(
  tx: AnyTransaction,
  operatorId: string,
  rental: BlockRental,
): Promise<ChargedRentLine[]> {
  const reversal = alias(ledgerLines, "reversal");
  const rows = await tx
    .select({
      kind: ledgerLines.kind,
      periodStartsAt: ledgerLines.periodStartsAt,
      amountCents: ledgerLines.amountCents,
      gstCents: ledgerLines.gstCents,
      isCorrection: ledgerLines.isCorrection,
      reversalId: reversal.id,
    })
    .from(ledgerLines)
    .leftJoin(
      reversal,
      and(eq(reversal.reversesId, ledgerLines.id), eq(reversal.operatorId, ledgerLines.operatorId)),
    )
    .where(
      and(
        eq(ledgerLines.operatorId, operatorId),
        eq(ledgerLines.rentalId, rental.id),
        isNotNull(ledgerLines.periodStartsAt),
      ),
    );
  return rows.flatMap((row) =>
    (row.kind === "charge" || row.kind === "credit") && row.periodStartsAt
      ? [
          {
            kind: row.kind,
            periodFirstBlock: blockAt(rental.handedOverAt, row.periodStartsAt),
            amountCents: row.amountCents,
            gstCents: row.gstCents,
            isCorrection: row.isCorrection,
            isReversed: row.reversalId !== null,
          },
        ]
      : [],
  );
}

function termsOf(rental: BlockRental, rates: readonly BlockRate[]): BlockRentTerms {
  return {
    isLongTerm: rental.isLongTerm,
    graceMinutes: rental.graceMinutes,
    longTermMinimumDays: rental.longTermMinimumDays,
    bookedBlocks: rental.bookedBlocks ?? 0,
    rates,
    isDailyRateWaived: rental.dailyRateWaivedReason !== null,
  };
}

function progressOf(rental: BlockRental, now: Date): RentProgress {
  return {
    // Before the handover moment (only a test clock gets there) nothing is due yet.
    currentBlock: blockAt(rental.handedOverAt, now),
    blocksUsed: rental.returnedAt
      ? blocksBetween(rental.handedOverAt, rental.returnedAt, rental.graceMinutes)
      : null,
  };
}

/** What a line says on the ledger, the invoice and the Renter's statement. */
function lineDescription(
  line: RentLineToAdd,
  rental: BlockRental,
  terms: BlockRentTerms,
  timeZone: string,
): string {
  const at = (block: number) =>
    formatDateTimeInTimeZone(blockStartsAt(rental.handedOverAt, block), timeZone);
  const span = `${at(line.period.firstBlock)} to ${at(line.period.endBlock)}`;
  if (!line.isCorrection) {
    return `Rent ${span}`;
  }
  const blocksUsed = rental.returnedAt
    ? blocksBetween(rental.handedOverAt, rental.returnedAt, rental.graceMinutes)
    : null;
  if (isRepricedAtDailyRate(terms, blocksUsed)) {
    return `Rent ${span} at the daily rate: back after ${blocksUsed} days, under the ${terms.longTermMinimumDays}-day minimum`;
  }
  const back = rental.returnedAt ? formatDateTimeInTimeZone(rental.returnedAt, timeZone) : null;
  const waived = terms.isDailyRateWaived ? ", daily rate waived" : "";
  return back
    ? `Rent ${span}: correction for the car coming back ${back}${waived}`
    : `Rent ${span}: correction`;
}

/** Adds one rent line and logs it (amounts only, rule 7). */
async function addRentLine(
  tx: AnyTransaction,
  context: RentContext,
  rental: BlockRental,
  line: RentLineToAdd,
  values: { chargeType: ChargeType; description: string },
): Promise<void> {
  const periodStartsAt = blockStartsAt(rental.handedOverAt, line.period.firstBlock);
  const timeZone = context.gst.timeZone;
  const periodDay = todayInTimeZone(periodStartsAt, timeZone);
  const gstCents =
    line.correctionGstCents ??
    gstForLine(
      line.amountCents,
      values.chargeType.gstTreatment,
      isGstRegisteredOn(context.gst.registeredFrom, periodDay),
    );
  const [added] = await tx
    .insert(ledgerLines)
    .values({
      operatorId: context.operatorId,
      rentalId: rental.id,
      kind: line.kind,
      chargeTypeId: values.chargeType.id,
      amountCents: line.amountCents,
      gstCents,
      description: values.description,
      effectiveOn: line.isCorrection
        ? todayInTimeZone(rental.returnedAt ?? context.now, timeZone)
        : periodDay,
      periodStartsAt,
      periodEndsAt: blockStartsAt(rental.handedOverAt, line.period.endBlock),
      isCorrection: line.isCorrection,
    })
    .returning({ id: ledgerLines.id });
  await recordActivity(tx, {
    operatorId: context.operatorId,
    actor: SYSTEM_ACTOR,
    entityType: ACTIVITY_ENTITY_TYPES.ledgerLine,
    entityId: added!.id,
    action: ACTIVITY_ACTIONS.created,
    valuesAfter: { kind: line.kind, amountCents: line.amountCents, gstCents },
  });
}

/**
 * One rental's rent, in its own transaction with the rental locked: every
 * period due that isn't charged yet, and a correction for any period whose
 * cost changed (a return, re-pricing or waiver). Running it again adds nothing.
 */
async function chargeBlockRental(
  database: AnyDatabase,
  context: Omit<RentContext, "gst">,
  rentalId: string,
): Promise<RentAdded> {
  return withTenant(database, context.operatorId, async (tx) => {
    const rental = await lockBlockRental(tx, context.operatorId, rentalId);
    if (!rental) {
      return NOTHING_ADDED;
    }
    const gst = await loadOperatorGst(tx, context.operatorId);
    const terms = termsOf(rental, await loadBlockRates(tx, context.operatorId, rental.id));
    const charged = await loadChargedRentLines(tx, context.operatorId, rental);
    const toAdd = rentLinesToAdd(terms, progressOf(rental, context.now), charged);
    if (toAdd.length === 0) {
      return NOTHING_ADDED;
    }
    const chargeType = await builtInChargeType(
      tx,
      context.operatorId,
      rental.isLongTerm ? "weekly_rent" : "daily_rent",
    );
    for (const line of toAdd) {
      await addRentLine(tx, { ...context, gst }, rental, line, {
        chargeType,
        description: lineDescription(line, rental, terms, gst.timeZone),
      });
    }
    const corrected = toAdd.filter((line) => line.isCorrection).length;
    return { charged: toAdd.length - corrected, corrected };
  });
}

/** The block rentals that can need rent now: out, or back within the lookback. */
async function rentalsToCharge(
  database: AnyDatabase,
  operatorId: string,
  now: Date,
  onlyRentalIds?: readonly string[],
): Promise<string[]> {
  const returnedSince = new Date(now.getTime() - RETURNED_LOOKBACK_DAYS * MILLISECONDS_PER_DAY);
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ id: rentals.id })
      .from(rentals)
      .where(
        and(
          eq(rentals.operatorId, operatorId),
          eq(rentals.rentModel, "blocks"),
          isNotNull(rentals.handedOverAt),
          or(
            eq(rentals.status, "active"),
            and(
              inArray(rentals.status, ["returned", "closed"]),
              gte(rentals.returnedAt, returnedSince),
            ),
          ),
          onlyRentalIds ? inArray(rentals.id, [...onlyRentalIds]) : undefined,
        ),
      ),
  );
  return rows.map((row) => row.id);
}

export interface RentRun extends RentAdded {
  /** Rentals skipped because something failed; the next run tries them again. */
  failedRentals: number;
}

/**
 * Adds the rent due for one business's rentals (or only the ones given),
 * each rental on its own so one failure never stops the rest (review A4-10).
 * Running it again adds nothing (rule 20).
 */
export async function chargeRentFor(
  database: AnyDatabase,
  operatorId: string,
  now: Date,
  onlyRentalIds?: readonly string[],
): Promise<RentRun> {
  const total: RentRun = { charged: 0, corrected: 0, failedRentals: 0 };
  for (const rentalId of await rentalsToCharge(database, operatorId, now, onlyRentalIds)) {
    try {
      const added = await chargeBlockRental(database, { operatorId, now }, rentalId);
      total.charged += added.charged;
      total.corrected += added.corrected;
    } catch (error) {
      total.failedRentals += 1;
      console.error("Charging one rental's rent failed", {
        operatorId,
        rentalId,
        ...describeErrorForLog(error),
      });
    }
  }
  return total;
}

/**
 * The daily rent run (docs/design/06): asks which businesses have rent due
 * (the one place ids cross businesses, rule 3), then charges each in its own
 * tenant context. One business failing never stops the others; a business
 * with a rental that failed counts as failed so the run reports it.
 */
export async function runRentJob(
  database: AnyDatabase,
  now: Date,
  isOutOfTime: () => boolean = () => false,
): Promise<OperatorRun> {
  const returnedSince = new Date(now.getTime() - RETURNED_LOOKBACK_DAYS * MILLISECONDS_PER_DAY);
  const operatorIds = await findDueOperators(
    database,
    sql`SELECT operator_id FROM app.operators_with_rent_due(${returnedSince.toISOString()}::timestamptz) AS operator_id`,
  );
  return forEachOperator(
    operatorIds,
    "Charging rent",
    async (operatorId) => {
      const run = await chargeRentFor(database, operatorId, now);
      if (run.failedRentals > 0) {
        throw new Error(`${run.failedRentals} rentals could not be charged`);
      }
      return run.charged + run.corrected;
    },
    isOutOfTime,
  );
}

/**
 * Charges one rental's rent at once, after its handover, return, waiver or
 * signed rate change, and issues the documents it needs, so the Operator and
 * Renter see it straight away. Never throws: if either fails, the nightly
 * run adds the same lines and documents (rule 20), so it is logged and left.
 */
export async function chargeRentNow(
  deps: BillingDependencies,
  operatorId: string,
  rentalId: string,
): Promise<void> {
  try {
    await chargeRentFor(deps.database, operatorId, deps.now(), [rentalId]);
  } catch (error) {
    console.error(
      "Charging rent straight after a rental change failed",
      describeErrorForLog(error),
    );
    return;
  }
  await issuePendingDocumentsQuietly(deps, { operatorId }, rentalId);
}
