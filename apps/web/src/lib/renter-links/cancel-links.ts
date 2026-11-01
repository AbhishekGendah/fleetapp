import type { AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, renterLinks } from "@fleetapp/db/schema";
import type { RenterLinkPurpose } from "@fleetapp/core";
import { and, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";

/** Which of the Renter's links to cancel: one kind, one rental's, or (empty) all of them. */
export interface LinksToCancel {
  purpose?: RenterLinkPurpose;
  rentalId?: string;
}

/** Only the Renter's details form link: a new one, or its submission approved, leaves signing alone. */
export const DETAILS_LINKS: LinksToCancel = { purpose: "details_form" };

/**
 * Cancels the Renter's links still in play, inside the caller's transaction.
 * Used whenever a link must stop working (rule 26): a new one of its kind is
 * sent, the Operator cancels it, what it was for is done, its rental is
 * cancelled, the Renter is archived, or the email it went to changes (the
 * last two cancel every link).
 */
export async function cancelLiveLinks(
  tx: AnyTransaction,
  actor: ActingUser,
  renterId: string,
  now: Date,
  which: LinksToCancel = {},
): Promise<boolean> {
  const cancelled = await tx
    .update(renterLinks)
    .set({ cancelledAt: now })
    .where(
      and(
        eq(renterLinks.operatorId, actor.operatorId),
        eq(renterLinks.renterId, renterId),
        which.purpose ? eq(renterLinks.purpose, which.purpose) : undefined,
        which.rentalId ? eq(renterLinks.rentalId, which.rentalId) : undefined,
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
