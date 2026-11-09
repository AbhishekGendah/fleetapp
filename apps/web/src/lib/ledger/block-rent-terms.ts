import {
  blockAt,
  blocksBetween,
  type BlockRate,
  type BlockRentTerms,
  type ChargedRentLine,
  type RentalStatus,
  type RentProgress,
} from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { ledgerLines, rentals } from "@fleetapp/db/schema";
import { ROW_LOCK } from "@fleetapp/db/row-lock";
import { and, eq, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

/**
 * What rent depends on for one block rental, read the one way the rent run
 * and the rental page both use, so the page's "Next rent" is the run's own
 * sum (one way of working out rent).
 */
export interface BlockRental {
  id: string;
  status: RentalStatus;
  plannedStart: Date;
  plannedEnd: Date | null;
  handedOverAt: Date | null;
  returnedAt: Date | null;
  isLongTerm: boolean;
  graceMinutes: number;
  longTermMinimumDays: number;
  bookedBlocks: number | null;
  dailyRateWaivedReason: string | null;
}

/**
 * One block rental of the Operator's, or null for a rental from before rent
 * in blocks (the run does not charge those). `shouldLock` holds it for the
 * transaction, so a return or signed change can't land halfway (review G2-1).
 */
export async function readBlockRental(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
  shouldLock: boolean,
): Promise<BlockRental | null> {
  const query = tx
    .select({
      id: rentals.id,
      status: rentals.status,
      plannedStart: rentals.plannedStart,
      plannedEnd: rentals.plannedEnd,
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
    );
  const [row] = shouldLock ? await query.for(ROW_LOCK) : await query;
  if (!row || row.isLongTerm === null) {
    return null;
  }
  return {
    ...row,
    isLongTerm: row.isLongTerm,
    graceMinutes: row.graceMinutes ?? 0,
    longTermMinimumDays: row.longTermMinimumDays ?? 1,
  };
}

export function blockTermsOf(rental: BlockRental, rates: readonly BlockRate[]): BlockRentTerms {
  return {
    isLongTerm: rental.isLongTerm,
    graceMinutes: rental.graceMinutes,
    longTermMinimumDays: rental.longTermMinimumDays,
    bookedBlocks: rental.bookedBlocks ?? 0,
    rates,
    isDailyRateWaived: rental.dailyRateWaivedReason !== null,
  };
}

export function rentProgressOf(
  rental: BlockRental & { handedOverAt: Date },
  now: Date,
): RentProgress {
  return {
    // Before the handover moment (only a test clock gets there) nothing is due yet.
    currentBlock: blockAt(rental.handedOverAt, now),
    blocksUsed: rental.returnedAt
      ? blocksBetween(rental.handedOverAt, rental.returnedAt, rental.graceMinutes)
      : null,
  };
}

/** The rental's block rent lines so far, each marked if the business has reversed it. */
export async function loadChargedRentLines(
  tx: AnyTransaction,
  operatorId: string,
  rental: { id: string; handedOverAt: Date },
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
