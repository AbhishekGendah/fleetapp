import { describeErrorForLog, MILLISECONDS_PER_DAY, type RenterLinkPurpose } from "@fleetapp/core";
import { generateSecretToken, hashSecretToken } from "@fleetapp/core/server";
import type { AnyDatabase } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, renterLinks } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailSender } from "@fleetapp/email";
import { renderRenterDetailsLinkEmail } from "@fleetapp/email";
import { and, desc, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { renterLinkPagePath } from "../paths";
import { lockCurrentRenter } from "../renters/renter-records";
import { cancelLiveLinks, DETAILS_LINKS } from "./cancel-links";
import { loadLinkSender } from "./link-email";

const PURPOSE = "details_form";

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

/** `isEmailed` false: the link exists but its email failed, so the Operator copies it instead. */
export type SendDetailsLinkResult =
  | { status: "sent"; url: string; expiresAt: Date; isEmailed: boolean }
  | { status: "no_email" }
  | { status: "not_found" };

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
    await cancelLiveLinks(tx, actor, renterId, now, DETAILS_LINKS);
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
  // The old link is already cancelled and only now can this one be shown, so
  // a failed email must still hand back the address to copy.
  let isEmailed = true;
  try {
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
  } catch (error) {
    // Never the error's details: they could hold the link's address.
    console.error("Emailing a details link failed", describeErrorForLog(error));
    isEmailed = false;
  }
  return { status: "sent", url, expiresAt, isEmailed };
}

/** Stops the Renter's details link working at once. */
export async function cancelDetailsLink(
  database: AnyDatabase,
  actor: ActingUser,
  renterId: string,
  now: Date,
): Promise<"cancelled" | "none"> {
  return withTenant(database, actor.operatorId, async (tx) =>
    (await cancelLiveLinks(tx, actor, renterId, now, DETAILS_LINKS)) ? "cancelled" : "none",
  );
}

/** A Renter link still in play (maybe expired or locked), as its sender sees it. */
export interface RenterLinkInPlay {
  sentToEmail: string;
  sentAt: Date;
  expiresAt: Date;
  isExpired: boolean;
  isLocked: boolean;
  /** A signing link whose paper no longer matches the rental: it can't be signed (review A3-6). */
  isPaperChanged?: boolean;
}

/** The columns a link in play is read from. */
export const LINK_IN_PLAY_COLUMNS = {
  sentToEmail: renterLinks.sentToEmail,
  sentAt: renterLinks.createdAt,
  expiresAt: renterLinks.expiresAt,
  lockedAt: renterLinks.lockedAt,
};

/** A link row as its sender sees it: whether it has run out or been locked by now. */
export function linkInPlay(
  link: { sentToEmail: string; sentAt: Date; expiresAt: Date; lockedAt: Date | null },
  now: Date,
): RenterLinkInPlay {
  return {
    sentToEmail: link.sentToEmail,
    sentAt: link.sentAt,
    expiresAt: link.expiresAt,
    isExpired: link.expiresAt <= now,
    isLocked: link.lockedAt !== null,
  };
}

/** The newest link of one purpose still in play for a Renter or a rental (maybe expired or locked), or null. */
export async function loadLinkInPlay(
  database: AnyDatabase,
  operatorId: string,
  which: { purpose: RenterLinkPurpose; renterId?: string; rentalId?: string },
  now: Date,
): Promise<RenterLinkInPlay | null> {
  const [link] = await withTenant(database, operatorId, (tx) =>
    tx
      .select(LINK_IN_PLAY_COLUMNS)
      .from(renterLinks)
      .where(
        and(
          eq(renterLinks.operatorId, operatorId),
          which.renterId ? eq(renterLinks.renterId, which.renterId) : undefined,
          which.rentalId ? eq(renterLinks.rentalId, which.rentalId) : undefined,
          eq(renterLinks.purpose, which.purpose),
          isNull(renterLinks.cancelledAt),
        ),
      )
      .orderBy(desc(renterLinks.createdAt))
      .limit(1),
  );
  return link ? linkInPlay(link, now) : null;
}

/** The Renter's details link still in play (maybe expired or locked), or null. */
export function loadDetailsLink(
  database: AnyDatabase,
  operatorId: string,
  renterId: string,
  now: Date,
): Promise<RenterLinkInPlay | null> {
  return loadLinkInPlay(database, operatorId, { purpose: PURPOSE, renterId }, now);
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
