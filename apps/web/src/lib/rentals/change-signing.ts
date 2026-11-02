import type { AnyDatabase } from "@fleetapp/db/client";
import { rentalChanges, renterLinks, rentals } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, isNull } from "drizzle-orm";

import type { ActingUser } from "../acting-user";
import { sendChangeSigningLink, type SendSigningLinkResult } from "../contracts/signing-links";
import { loadDefaultTemplate } from "../contracts/templates";
import { cancelLiveLinks } from "../renter-links/cancel-links";
import {
  LINK_IN_PLAY_COLUMNS,
  linkInPlay,
  type LinkDependencies,
  type RenterLinkInPlay,
} from "../renter-links/details-links";
import {
  proposeRateChange,
  withdrawWaitingChange,
  type RateChangeResult,
  type RentalChange,
} from "./rental-changes";
import type { RentalClock } from "./rental-records";

export type RateChangeSendResult =
  | { status: "sent"; changeId: string; isEmailed: boolean }
  | Exclude<RateChangeResult, { status: "waiting" }>
  | Exclude<SendSigningLinkResult, { status: "sent" }>;

/**
 * A new weekly rate, sent straight to the Renter to sign. If the form cannot
 * go (no template, gaps in it, no email for the Renter), the change is
 * withdrawn again, so nothing is left waiting that the Renter never saw.
 */
export async function changeWeeklyRate(
  deps: LinkDependencies,
  actor: ActingUser,
  rentalId: string,
  request: { weeklyRateCents: number; appliesFrom: string; reason: string },
  clock: RentalClock & { currentRateCents: number },
): Promise<RateChangeSendResult> {
  if (!(await loadDefaultTemplate(deps.database, actor.operatorId, "change_of_terms"))) {
    return { status: "no_template" };
  }
  const proposed = await proposeRateChange(deps.database, actor, rentalId, request, clock);
  if (proposed.status !== "waiting") {
    return proposed;
  }
  const change = await loadChange(deps.database, actor.operatorId, proposed.changeId);
  const sent = change ? await sendChangeSigningLink(deps, actor, change, clock) : null;
  if (sent?.status === "sent") {
    return { status: "sent", changeId: proposed.changeId, isEmailed: sent.isEmailed };
  }
  await withTenant(deps.database, actor.operatorId, (tx) =>
    withdrawWaitingChange(tx, actor, proposed.changeId, clock.now),
  );
  return sent ?? { status: "not_found" };
}

/** Sends (or sends again) a change's form for the Renter to sign. */
export async function sendChangeForSigning(
  deps: LinkDependencies,
  actor: ActingUser,
  changeId: string,
  clock: RentalClock,
): Promise<SendSigningLinkResult> {
  const change = await loadChange(deps.database, actor.operatorId, changeId);
  return change ? sendChangeSigningLink(deps, actor, change, clock) : { status: "not_found" };
}

/** Withdraws a rate change still waiting for signature, and stops its link working. */
export async function withdrawChange(
  database: AnyDatabase,
  actor: ActingUser,
  changeId: string,
  now: Date,
): Promise<"withdrawn" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const change = await withdrawWaitingChange(tx, actor, changeId, now);
    if (!change) {
      return "not_found";
    }
    const [rental] = await tx
      .select({ renterId: rentals.renterId })
      .from(rentals)
      .where(and(eq(rentals.id, change.rentalId), eq(rentals.operatorId, actor.operatorId)));
    if (rental) {
      await cancelLiveLinks(tx, actor, rental.renterId, now, {
        rentalId: change.rentalId,
        purpose: "sign_change",
      });
    }
    return "withdrawn";
  });
}

async function loadChange(
  database: AnyDatabase,
  operatorId: string,
  changeId: string,
): Promise<RentalChange | null> {
  const [change] = await withTenant(database, operatorId, (tx) =>
    tx
      .select()
      .from(rentalChanges)
      .where(and(eq(rentalChanges.id, changeId), eq(rentalChanges.operatorId, operatorId))),
  );
  return change ?? null;
}

export interface RentalChangeRow extends RentalChange {
  /** The live signing link for this change, if one is out. */
  link: RenterLinkInPlay | null;
}

/** A rental's changes of terms, newest first, each with its signing link if one is out. */
export async function listRentalChanges(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
  now: Date,
): Promise<RentalChangeRow[]> {
  return withTenant(database, operatorId, async (tx) => {
    const changes = await tx
      .select()
      .from(rentalChanges)
      .where(and(eq(rentalChanges.operatorId, operatorId), eq(rentalChanges.rentalId, rentalId)))
      .orderBy(desc(rentalChanges.createdAt));
    const links = await tx
      .select({ rentalChangeId: renterLinks.rentalChangeId, ...LINK_IN_PLAY_COLUMNS })
      .from(renterLinks)
      .where(
        and(
          eq(renterLinks.operatorId, operatorId),
          eq(renterLinks.rentalId, rentalId),
          eq(renterLinks.purpose, "sign_change"),
          isNull(renterLinks.cancelledAt),
        ),
      );
    return changes.map((change) => {
      const link = links.find((candidate) => candidate.rentalChangeId === change.id);
      return {
        ...change,
        link: link ? linkInPlay(link, now) : null,
      };
    });
  });
}
