import {
  describeErrorForLog,
  MILLISECONDS_PER_DAY,
  SIGNING_LINK_DAYS,
  type MergeFieldKey,
} from "@fleetapp/core";
import { generateSecretToken, hashSecretToken } from "@fleetapp/core/server";
import type { AnyDatabase } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  issuedDocuments,
  renterLinks,
  rentals,
  renters,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { renderRenterSigningLinkEmail } from "@fleetapp/email";
import { and, desc, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import type { RentalClock } from "../rentals/rental-records";
import { cancelLiveLinks } from "../renter-links/cancel-links";
import {
  renterLinkUrl,
  type LinkDependencies,
  type RenterLinkInPlay,
} from "../renter-links/details-links";
import { loadLinkSender } from "../renter-links/link-email";
import { fillContract } from "./filled-contract";
import { loadDefaultTemplate } from "./templates";

/** A contract can be sent for signing until the car is handed over. */
const SIGNABLE_STATUSES = new Set(["draft", "booked"]);

export type SendSigningLinkResult =
  | { status: "sent"; url: string; expiresAt: Date; isEmailed: boolean }
  | { status: "missing"; fields: MergeFieldKey[] }
  | { status: "not_found" | "not_signable" | "no_email" | "no_template" | "already_signed" };

/** "1ABC234 Toyota Corolla, from 1 June 2027": the rental in a few words, for emails. */
export function rentalSummaryText(data: {
  carRego: string | null;
  carMakeModel: string | null;
  rentalStart: string | null;
}): string {
  const startDay = data.rentalStart?.split(",")[0];
  return `${data.carRego ?? ""} ${data.carMakeModel ?? ""}${startDay ? `, from ${startDay}` : ""}`.trim();
}

/**
 * Sends the Renter their contract to sign (rule 26): a new secret whose
 * fingerprint alone is kept, lasting a week, replacing any signing link for
 * this rental. It records the template version and the fingerprint of the
 * filled-in text it was sent for, so if either changes before signing, the
 * signing is refused. Every field the template uses must be on file: a
 * contract is never sent with gaps in it.
 */
export async function sendSigningLink(
  deps: LinkDependencies,
  actor: ActingUser,
  rentalId: string,
  clock: RentalClock,
): Promise<SendSigningLinkResult> {
  const template = await loadDefaultTemplate(deps.database, actor.operatorId, "contract");
  if (!template) {
    return { status: "no_template" };
  }
  const filled = await fillContract(
    deps.database,
    actor.operatorId,
    rentalId,
    template.content,
    clock,
  );
  if (!filled) {
    return { status: "not_found" };
  }
  if (filled.missing.length > 0) {
    return { status: "missing", fields: filled.missing };
  }
  const token = generateSecretToken();
  const expiresAt = new Date(clock.now.getTime() + SIGNING_LINK_DAYS * MILLISECONDS_PER_DAY);
  const prepared = await withTenant(deps.database, actor.operatorId, async (tx) => {
    const [rental] = await tx
      .select({ status: rentals.status, renterId: rentals.renterId })
      .from(rentals)
      .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, actor.operatorId)))
      .for("update");
    if (!rental) {
      return { status: "not_found" as const };
    }
    if (!SIGNABLE_STATUSES.has(rental.status)) {
      return { status: "not_signable" as const };
    }
    const [signed] = await tx
      .select({ id: issuedDocuments.id })
      .from(issuedDocuments)
      .where(and(eq(issuedDocuments.rentalId, rentalId), eq(issuedDocuments.kind, "contract")))
      .limit(1);
    if (signed) {
      return { status: "already_signed" as const };
    }
    const [renter] = await tx
      .select({
        email: renters.email,
        fullName: renters.fullName,
        preferredName: renters.preferredName,
      })
      .from(renters)
      .where(and(eq(renters.id, rental.renterId), isNull(renters.archivedAt)));
    if (!renter?.email) {
      return { status: "no_email" as const };
    }
    await cancelLiveLinks(tx, actor, rental.renterId, clock.now, { rentalId });
    const [link] = await tx
      .insert(renterLinks)
      .values({
        operatorId: actor.operatorId,
        renterId: rental.renterId,
        purpose: "sign_contract",
        tokenHash: hashSecretToken(token),
        sentToEmail: renter.email,
        expiresAt,
        createdByUserId: actor.userId,
        rentalId,
        templateVersionId: template.latestVersionId,
        contractFingerprint: filled.fingerprint,
        createdAt: clock.now,
        updatedAt: clock.now,
      })
      .returning({ id: renterLinks.id });
    if (!link) {
      throw new Error("The link was not saved.");
    }
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.renterLink,
      entityId: link.id,
      action: ACTIVITY_ACTIONS.sent,
      valuesAfter: {
        renterId: rental.renterId,
        rentalId,
        purpose: "sign_contract",
        templateVersion: template.latestVersion,
        expiresAt: expiresAt.toISOString(),
      },
    });
    return {
      status: "ready" as const,
      email: renter.email,
      name: renter.preferredName ?? renter.fullName,
      sender: await loadLinkSender(tx, actor.operatorId),
    };
  });
  if (prepared.status !== "ready") {
    return prepared;
  }
  const url = renterLinkUrl(deps.appUrl, token);
  let isEmailed = true;
  try {
    await deps.emailSender.send(
      await renderRenterSigningLinkEmail({
        to: prepared.email,
        renterName: prepared.name,
        operatorName: prepared.sender.operatorName,
        replyTo: prepared.sender.replyTo,
        rentalSummary: rentalSummaryText(filled.data),
        linkUrl: url,
        validUntil: deps.describeDay(expiresAt),
      }),
    );
  } catch (error) {
    // Never the error's details: they could hold the link's address.
    console.error("Emailing a signing link failed", describeErrorForLog(error));
    isEmailed = false;
  }
  return { status: "sent", url, expiresAt, isEmailed };
}

/** Stops the rental's signing link working at once. */
export async function cancelSigningLink(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  now: Date,
): Promise<"cancelled" | "none"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const [rental] = await tx
      .select({ renterId: rentals.renterId })
      .from(rentals)
      .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, actor.operatorId)));
    if (!rental) {
      return "none";
    }
    return (await cancelLiveLinks(tx, actor, rental.renterId, now, { rentalId }))
      ? "cancelled"
      : "none";
  });
}

export interface SigningStatus {
  signed: { documentId: string; version: number; issuedAt: Date } | null;
  link: RenterLinkInPlay | null;
}

/** Whether the rental's contract is signed, and the signing link in play if not. */
export async function loadSigningStatus(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
  now: Date,
): Promise<SigningStatus> {
  return withTenant(database, operatorId, async (tx) => {
    const [signed] = await tx
      .select({
        documentId: issuedDocuments.id,
        version: issuedDocuments.version,
        issuedAt: issuedDocuments.issuedAt,
      })
      .from(issuedDocuments)
      .where(
        and(
          eq(issuedDocuments.operatorId, operatorId),
          eq(issuedDocuments.rentalId, rentalId),
          eq(issuedDocuments.kind, "contract"),
        ),
      )
      .orderBy(desc(issuedDocuments.version))
      .limit(1);
    const [link] = await tx
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
          eq(renterLinks.rentalId, rentalId),
          isNull(renterLinks.cancelledAt),
        ),
      )
      .limit(1);
    return {
      signed: signed ?? null,
      link: link
        ? {
            sentToEmail: link.sentToEmail,
            sentAt: link.sentAt,
            expiresAt: link.expiresAt,
            isExpired: link.expiresAt <= now,
            isLocked: link.lockedAt !== null,
          }
        : null,
    };
  });
}
