import type { AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, renterLinks } from "@fleetapp/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";

const PURPOSE = "details_form";

/**
 * Cancels the Renter's details link still in play, if any, inside the
 * caller's transaction. Used whenever a link must stop working: a new one is
 * sent, the Operator cancels it, what it was for is approved, the Renter is
 * archived, or the email it went to changes (rule 26).
 */
export async function cancelLiveLinks(
  tx: AnyTransaction,
  actor: ActingUser,
  renterId: string,
  now: Date,
): Promise<boolean> {
  const cancelled = await tx
    .update(renterLinks)
    .set({ cancelledAt: now })
    .where(
      and(
        eq(renterLinks.operatorId, actor.operatorId),
        eq(renterLinks.renterId, renterId),
        eq(renterLinks.purpose, PURPOSE),
        isNull(renterLinks.cancelledAt),
      ),
    )
    .returning({ id: renterLinks.id });
  for (const link of cancelled) {
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.renterLink,
      entityId: link.id,
      action: ACTIVITY_ACTIONS.revoked,
      valuesAfter: { renterId },
    });
  }
  return cancelled.length > 0;
}
