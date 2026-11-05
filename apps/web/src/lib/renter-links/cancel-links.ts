import { recordActivity, type ActivityEntry } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, renterLinks, rentals } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { RenterLinkPurpose } from "@fleetapp/core";
import { and, eq, isNull } from "drizzle-orm";

import type { ActingUser } from "../acting-user";

/** Which of the Renter's links to cancel: one kind, one rental's, or (empty) all of them. */
export interface LinksToCancel {
  purpose?: RenterLinkPurpose;
  rentalId?: string;
  /** One change of terms' own form link, leaving the rental's other changes' links alone (review A3-2). */
  rentalChangeId?: string;
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
export function cancelLiveLinks(
  tx: AnyTransaction,
  actor: ActingUser,
  renterId: string,
  now: Date,
  which: LinksToCancel = {},
): Promise<boolean> {
  return cancelLinksAs(
    tx,
    { operatorId: actor.operatorId, type: "user", id: actor.userId },
    {
      renterId,
      now,
      which,
    },
  );
}

/**
 * The same, logged as whoever stopped them: a User, or a link itself (a
 * signing link that hands on to a payments link once signed).
 */
export async function cancelLinksAs(
  tx: AnyTransaction,
  by: { operatorId: string } & ActivityEntry["actor"],
  target: { renterId: string; now: Date; which: LinksToCancel },
): Promise<boolean> {
  const { renterId, now, which } = target;
  const cancelled = await tx
    .update(renterLinks)
    .set({ cancelledAt: now })
    .where(
      and(
        eq(renterLinks.operatorId, by.operatorId),
        eq(renterLinks.renterId, renterId),
        which.purpose ? eq(renterLinks.purpose, which.purpose) : undefined,
        which.rentalId ? eq(renterLinks.rentalId, which.rentalId) : undefined,
        which.rentalChangeId ? eq(renterLinks.rentalChangeId, which.rentalChangeId) : undefined,
        isNull(renterLinks.cancelledAt),
      ),
    )
    .returning({ id: renterLinks.id });
  for (const link of cancelled) {
    await recordActivity(tx, {
      operatorId: by.operatorId,
      actor: { type: by.type, id: by.id },
      entityType: ACTIVITY_ENTITY_TYPES.renterLink,
      entityId: link.id,
      action: ACTIVITY_ACTIONS.revoked,
      valuesAfter: { renterId },
    });
  }
  return cancelled.length > 0;
}

/**
 * The business's "Cancel link" for one of a rental's links (its contract's
 * signing link, or its payments link): it stops working at once (review A3-3).
 */
export async function cancelRentalLink(
  database: AnyDatabase,
  actor: ActingUser,
  link: { rentalId: string; purpose: RenterLinkPurpose },
  now: Date,
): Promise<"cancelled" | "none"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const [rental] = await tx
      .select({ renterId: rentals.renterId })
      .from(rentals)
      .where(and(eq(rentals.id, link.rentalId), eq(rentals.operatorId, actor.operatorId)));
    if (!rental) {
      return "none";
    }
    return (await cancelLiveLinks(tx, actor, rental.renterId, now, link)) ? "cancelled" : "none";
  });
}
