import { generateSecretToken, hashSecretToken } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, renterLinks } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailSender } from "@fleetapp/email";
import { renderRenterDetailsLinkEmail } from "@fleetapp/email";
import { and, desc, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { renterLinkPagePath } from "../paths";
import { lockCurrentRenter } from "../renters/renter-records";
import { loadLinkSender } from "./link-email";

const PURPOSE = "details_form";
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface LinkDependencies {
  database: AnyDatabase;
  emailSender: EmailSender;
  now: () => Date;
  /** The Operator app's address, where Renter link pages live (APP_URL). */
  appUrl: string;
  /** "Friday 6 November", in the Operator's timezone. */
  describeDay: (moment: Date) => string;
}

export function renterLinkUrl(appUrl: string, token: string): string {
  return new URL(renterLinkPagePath(token), appUrl).toString();
}

export type SendDetailsLinkResult =
  | { status: "sent"; url: string; expiresAt: Date }
  | { status: "no_email" }
  | { status: "not_found" };

/** Cancels the Renter's details link still in play, if any, inside the caller's transaction. */
async function cancelLiveLinks(
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

/**
 * Sends a Renter their details form link by email (rule 26): a new secret
 * whose fingerprint alone is kept, lasting `validDays`, replacing any link
 * still in play. The address is handed back once, to copy; it is never shown
 * again. Needs an email on file: the one-time codes go there.
 */
export async function sendDetailsLink(
  deps: LinkDependencies,
  actor: ActingUser,
  renterId: string,
  validDays: number,
): Promise<SendDetailsLinkResult> {
  const now = deps.now();
  const token = generateSecretToken();
  const expiresAt = new Date(now.getTime() + validDays * MILLISECONDS_PER_DAY);
  const prepared = await withTenant(deps.database, actor.operatorId, async (tx) => {
    const renter = await lockCurrentRenter(tx, actor.operatorId, renterId);
    if (!renter) {
      return { status: "not_found" as const };
    }
    if (!renter.email) {
      return { status: "no_email" as const };
    }
    await cancelLiveLinks(tx, actor, renterId, now);
    const [link] = await tx
      .insert(renterLinks)
      .values({
        operatorId: actor.operatorId,
        renterId,
        purpose: PURPOSE,
        tokenHash: hashSecretToken(token),
        sentToEmail: renter.email,
        expiresAt,
        createdByUserId: actor.userId,
      })
      .returning({ id: renterLinks.id });
    if (!link) {
      throw new Error("The link was not saved.");
    }
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.renterLink,
      entityId: link.id,
      action: ACTIVITY_ACTIONS.sent,
      valuesAfter: { renterId, expiresAt: expiresAt.toISOString() },
    });
    const sender = await loadLinkSender(tx, actor.operatorId);
    return {
      status: "ready" as const,
      email: renter.email,
      name: renter.preferredName ?? renter.fullName,
      sender,
    };
  });
  if (prepared.status !== "ready") {
    return prepared;
  }
  const url = renterLinkUrl(deps.appUrl, token);
  await deps.emailSender.send(
    await renderRenterDetailsLinkEmail({
      to: prepared.email,
      renterName: prepared.name,
      operatorName: prepared.sender.operatorName,
      replyTo: prepared.sender.replyTo,
      linkUrl: url,
      validUntil: deps.describeDay(expiresAt),
    }),
  );
  return { status: "sent", url, expiresAt };
}

/** Stops the Renter's details link working at once. */
export async function cancelDetailsLink(
  database: AnyDatabase,
  actor: ActingUser,
  renterId: string,
  now: Date,
): Promise<"cancelled" | "none"> {
  return withTenant(database, actor.operatorId, async (tx) =>
    (await cancelLiveLinks(tx, actor, renterId, now)) ? "cancelled" : "none",
  );
}

export interface DetailsLinkStatus {
  sentToEmail: string;
  sentAt: Date;
  expiresAt: Date;
  isExpired: boolean;
  isLocked: boolean;
}

/** The Renter's details link still in play (maybe expired or locked), or null. */
export async function loadDetailsLink(
  database: AnyDatabase,
  operatorId: string,
  renterId: string,
  now: Date,
): Promise<DetailsLinkStatus | null> {
  const [link] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        sentToEmail: renterLinks.sentToEmail,
        sentAt: renterLinks.createdAt,
        expiresAt: renterLinks.expiresAt,
        lockedAt: renterLinks.lockedAt,
      })
      .from(renterLinks)
      .where(
        and(
          eq(renterLinks.operatorId, operatorId),
          eq(renterLinks.renterId, renterId),
          eq(renterLinks.purpose, PURPOSE),
          isNull(renterLinks.cancelledAt),
        ),
      )
      .orderBy(desc(renterLinks.createdAt))
      .limit(1),
  );
  if (!link) {
    return null;
  }
  return {
    sentToEmail: link.sentToEmail,
    sentAt: link.sentAt,
    expiresAt: link.expiresAt,
    isExpired: link.expiresAt <= now,
    isLocked: link.lockedAt !== null,
  };
}

/** Every link the Renter has had, for their Log. */
export async function listRenterLinkIds(
  database: AnyDatabase,
  operatorId: string,
  renterId: string,
): Promise<string[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ id: renterLinks.id })
      .from(renterLinks)
      .where(and(eq(renterLinks.operatorId, operatorId), eq(renterLinks.renterId, renterId))),
  );
  return rows.map((row) => row.id);
}
