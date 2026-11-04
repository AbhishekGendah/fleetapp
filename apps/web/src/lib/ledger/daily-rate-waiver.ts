import { blocksBetween, MILLISECONDS_PER_DAY } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, ledgerLines, rentals } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { recordUserChange, type ActingUser } from "../acting-user";
import { RETURNED_LOOKBACK_DAYS } from "./rent-job";

export type DailyRateWaiverResult = "waived" | "not_found" | "not_repriced";

/** What decides whether a rental was re-priced at the daily rate (and not waived yet). */
export interface WaivableRental {
  rentModel: string;
  isLongTerm: boolean | null;
  handedOverAt: Date | null;
  returnedAt: Date | null;
  graceMinutes: number | null;
  longTermMinimumDays: number | null;
  dailyRateWaivedReason: string | null;
}

/**
 * Whether a returned long-term rental came back sooner than its minimum, so
 * it was re-priced at the daily rate, and the business has not waived it yet.
 */
export function isDailyRateWaivable(rental: WaivableRental, now: Date): boolean {
  if (
    rental.rentModel !== "blocks" ||
    !rental.isLongTerm ||
    !rental.handedOverAt ||
    !rental.returnedAt ||
    rental.dailyRateWaivedReason !== null
  ) {
    return false;
  }
  // The rent run stops correcting a rental this long after its return, so a
  // later waiver would credit nothing.
  const lookbackStart = now.getTime() - RETURNED_LOOKBACK_DAYS * MILLISECONDS_PER_DAY;
  if (rental.returnedAt.getTime() < lookbackStart) {
    return false;
  }
  const blocksUsed = blocksBetween(
    rental.handedOverAt,
    rental.returnedAt,
    rental.graceMinutes ?? 0,
  );
  return blocksUsed < (rental.longTermMinimumDays ?? 0);
}

/**
 * Whether the business has reversed any of the rental's rent by hand: the run
 * then leaves those weeks as they are, so a waiver would credit nothing.
 */
async function hasReversedRent(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<boolean> {
  const reversed = alias(ledgerLines, "reversed");
  const [found] = await tx
    .select({ id: ledgerLines.id })
    .from(ledgerLines)
    .innerJoin(
      reversed,
      and(eq(reversed.id, ledgerLines.reversesId), eq(reversed.operatorId, ledgerLines.operatorId)),
    )
    .where(
      and(
        eq(ledgerLines.operatorId, operatorId),
        eq(ledgerLines.rentalId, rentalId),
        inArray(reversed.kind, ["charge", "credit"]),
        isNotNull(reversed.periodStartsAt),
      ),
    )
    .limit(1);
  return found !== undefined;
}

/**
 * The business waives the daily-rate re-pricing of a long-term rental that
 * came back early (approved by Abhi, 4 Nov 2026): the reason is kept on the
 * rental and the change logged (rule 19). The caller then runs the rent for
 * the rental, which credits the difference with its adjustment note.
 */
export async function waiveDailyRate(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  reason: string,
): Promise<DailyRateWaiverResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const [rental] = await tx
      .select()
      .from(rentals)
      .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, actor.operatorId)))
      .for("update");
    if (!rental) {
      return "not_found";
    }
    if (
      !isDailyRateWaivable(rental, new Date()) ||
      (await hasReversedRent(tx, actor.operatorId, rental.id))
    ) {
      return "not_repriced";
    }
    await tx
      .update(rentals)
      .set({ dailyRateWaivedReason: reason, updatedAt: new Date() })
      .where(eq(rentals.id, rental.id));
    // The reason may say something personal about the Renter: logged as given, not its words.
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.rental,
      entityId: rental.id,
      action: ACTIVITY_ACTIONS.updated,
      valuesAfter: { isDailyRateWaived: true },
    });
    return "waived";
  });
}
