import { blocksBetween } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, rentals } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";

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
export function isDailyRateWaivable(rental: WaivableRental): boolean {
  if (
    rental.rentModel !== "blocks" ||
    !rental.isLongTerm ||
    !rental.handedOverAt ||
    !rental.returnedAt ||
    rental.dailyRateWaivedReason !== null
  ) {
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
    if (!isDailyRateWaivable(rental)) {
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
