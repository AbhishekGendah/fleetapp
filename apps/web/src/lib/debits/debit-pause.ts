import type { AnyDatabase } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, rentals } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { eq } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { lockPaymentRental } from "../bonds/bond-records";

export type DebitPauseResult = "done" | "not_found" | "unchanged";

/**
 * Pauses a rental's automatic debits (a payment arrangement, a dispute) or
 * resumes them, with the rental locked as the debit run takes it, and
 * logged (rule 19; the reason stays on the rental, not in the log). Charges
 * still go on the ledger and invoices still go out. Weeks that start while
 * paused are not debited later: the resume's own log entry dates it.
 */
export async function setDebitsPaused(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  pause: { reason: string } | null,
): Promise<DebitPauseResult> {
  return withTenant(database, actor.operatorId, async (tx): Promise<DebitPauseResult> => {
    const rental = await lockPaymentRental(tx, actor.operatorId, rentalId);
    if (!rental) {
      return "not_found";
    }
    const [current] = await tx
      .select({ pausedAt: rentals.debitsPausedAt })
      .from(rentals)
      .where(eq(rentals.id, rentalId));
    if ((current?.pausedAt !== null) === (pause !== null)) {
      return "unchanged";
    }
    await tx
      .update(rentals)
      .set({
        debitsPausedAt: pause ? new Date() : null,
        debitsPausedReason: pause?.reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(rentals.id, rentalId));
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.rental,
      entityId: rentalId,
      action: pause ? ACTIVITY_ACTIONS.debitsPaused : ACTIVITY_ACTIONS.debitsResumed,
    });
    return "done";
  });
}
