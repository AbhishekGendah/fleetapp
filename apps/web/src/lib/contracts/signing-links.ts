import {
  contractKindFor,
  describeErrorForLog,
  MILLISECONDS_PER_DAY,
  SIGNING_LINK_DAYS,
  type ContractTemplateKind,
  type MergeFieldKey,
  isContractSignable,
  type RentalStatus,
} from "@fleetapp/core";
import { generateSecretToken, hashSecretToken } from "@fleetapp/core/server";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  issuedDocuments,
  renterLinks,
  rentals,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { ROW_LOCK } from "@fleetapp/db/row-lock";
import { renderRenterSigningLinkEmail } from "@fleetapp/email";
import { and, desc, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import {
  changeFieldsOf,
  changeSigningProblemNow,
  isRiseNoticedNow,
  lockChange,
  type RentalChange,
} from "../rentals/rental-changes";
import type { RentalClock } from "../rentals/rental-records";
import { cancelLiveLinks, cancelRentalLink } from "../renter-links/cancel-links";
import { rentalRenterStanding } from "../renters/renter-archived";
import { lockLinkRecipient } from "../renters/renter-records";
import {
  LINK_IN_PLAY_COLUMNS,
  linkInPlay,
  renterLinkUrl,
  type LinkDependencies,
  type RenterLinkInPlay,
} from "../renter-links/details-links";
import { loadLinkSender } from "../renter-links/link-email";
import type { ChangeFields } from "./contract-data";
import { fillContract, type FilledContract } from "./filled-contract";
import { loadDefaultTemplate } from "./templates";

export type SendSigningLinkResult =
  | { status: "sent"; url: string; expiresAt: Date; isEmailed: boolean }
  | { status: "missing"; fields: MergeFieldKey[] }
  | {
      status:
        | "not_found"
        | "not_signable"
        | "no_email"
        | "renter_archived"
        | "no_template"
        | "no_business_template"
        | "already_signed";
    };

/** "1ABC234 Toyota Corolla, from 1 June 2027": the rental in a few words, for emails. */
export function rentalSummaryText(data: {
  carRego: string | null;
  carMakeModel: string | null;
  rentalStart: string | null;
}): string {
  const startDay = data.rentalStart?.split(",")[0];
  return `${data.carRego ?? ""} ${data.carMakeModel ?? ""}${startDay ? `, from ${startDay}` : ""}`.trim();
}

/** What a signing link is sent for: the rental's contract, or one change of terms. */
interface SigningLinkSubject {
  purpose: "sign_contract" | "sign_change";
  rentalId: string;
  rentalChangeId: string | null;
  template: { latestVersionId: string; latestVersion: number };
  filled: FilledContract;
  /** Why it cannot be sent after all, checked with the rental locked (the shared signing rules). */
  refusal: (
    tx: AnyTransaction,
    rental: { status: RentalStatus; handedOverAt: Date | null },
  ) => Promise<SendSigningLinkRefusal | null>;
}

type SendSigningLinkRefusal = "already_signed" | "not_signable";

/**
 * Sends the Renter a link to sign (rule 26): a new secret whose fingerprint
 * alone is kept, lasting a week, replacing any link of the same purpose for
 * this rental. It records the template version and the fingerprint of the
 * filled-in text it was sent for, so if either changes before signing, the
 * signing is refused.
 */
async function sendLinkFor(
  deps: LinkDependencies,
  actor: ActingUser,
  subject: SigningLinkSubject,
  clock: RentalClock,
): Promise<SendSigningLinkResult> {
  const { rentalId } = subject;
  const token = generateSecretToken();
  const expiresAt = new Date(clock.now.getTime() + SIGNING_LINK_DAYS * MILLISECONDS_PER_DAY);
  const prepared = await withTenant(deps.database, actor.operatorId, async (tx) => {
    const [rental] = await tx
      .select({
        status: rentals.status,
        renterId: rentals.renterId,
        handedOverAt: rentals.handedOverAt,
      })
      .from(rentals)
      .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, actor.operatorId)))
      .for(ROW_LOCK);
    if (!rental) {
      return { status: "not_found" as const };
    }
    const refusal = await subject.refusal(tx, rental);
    if (refusal) {
      return { status: refusal };
    }
    const recipient = await lockLinkRecipient(tx, actor.operatorId, rental.renterId);
    if (recipient.status !== "found") {
      return { status: recipient.status };
    }
    const { renter, email } = recipient;
    // Only this paper's own link: another change's form keeps working (review A3-2).
    await cancelLiveLinks(tx, actor, rental.renterId, clock.now, {
      rentalId,
      purpose: subject.purpose,
      rentalChangeId: subject.rentalChangeId ?? undefined,
    });
    const [link] = await tx
      .insert(renterLinks)
      .values({
        operatorId: actor.operatorId,
        renterId: rental.renterId,
        purpose: subject.purpose,
        tokenHash: hashSecretToken(token),
        sentToEmail: email,
        expiresAt,
        createdByUserId: actor.userId,
        rentalId,
        rentalChangeId: subject.rentalChangeId,
        templateVersionId: subject.template.latestVersionId,
        contractFingerprint: subject.filled.fingerprint,
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
        purpose: subject.purpose,
        rentalChangeId: subject.rentalChangeId,
        templateVersion: subject.template.latestVersion,
        expiresAt: expiresAt.toISOString(),
      },
    });
    return {
      status: "ready" as const,
      email,
      // A business's link greets its contact, who signs for it.
      name: renter.contactName ?? renter.preferredName ?? renter.fullName,
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
        document: subject.purpose === "sign_change" ? "change_of_terms" : "contract",
        renterName: prepared.name,
        operatorName: prepared.sender.operatorName,
        replyTo: prepared.sender.replyTo,
        rentalSummary: rentalSummaryText(subject.filled.data),
        linkUrl: url,
        validUntil: deps.describeMoment(expiresAt),
      }),
    );
  } catch (error) {
    // Never the error's details: they could hold the link's address.
    console.error("Emailing a signing link failed", describeErrorForLog(error));
    isEmailed = false;
  }
  return { status: "sent", url, expiresAt, isEmailed };
}

/** The template filled in for a rental, or why it cannot be sent: no template, gaps, not theirs. */
async function filledFor(
  deps: LinkDependencies,
  actor: ActingUser,
  request: {
    kind: ContractTemplateKind;
    rentalId: string;
    clock: RentalClock;
    change?: ChangeFields;
  },
) {
  const template = await loadDefaultTemplate(deps.database, actor.operatorId, request.kind);
  if (!template) {
    return {
      status:
        request.kind === "business_contract"
          ? ("no_business_template" as const)
          : ("no_template" as const),
    };
  }
  const filled = await fillContract(
    deps.database,
    actor.operatorId,
    request.rentalId,
    template.content,
    request.clock,
    request.change,
  );
  if (!filled) {
    return { status: "not_found" as const };
  }
  if (filled.missing.length > 0) {
    return { status: "missing" as const, fields: filled.missing };
  }
  return { status: "ready" as const, template, filled };
}

/** The template kind a rental's contract comes from: a business Renter's own (decision 10). */
export async function contractKindOfRental(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
): Promise<ContractTemplateKind | null> {
  const renter = await withTenant(database, operatorId, (tx) =>
    rentalRenterStanding(tx, operatorId, rentalId),
  );
  return renter ? contractKindFor(renter.kind) : null;
}

/**
 * Sends the Renter their contract to sign. Every field the template uses
 * must be on file: a contract is never sent with gaps in it.
 */
export async function sendSigningLink(
  deps: LinkDependencies,
  actor: ActingUser,
  rentalId: string,
  clock: RentalClock,
): Promise<SendSigningLinkResult> {
  const kind = await contractKindOfRental(deps.database, actor.operatorId, rentalId);
  if (!kind) {
    return { status: "not_found" };
  }
  const ready = await filledFor(deps, actor, { kind, rentalId, clock });
  if (ready.status !== "ready") {
    return ready;
  }
  return sendLinkFor(
    deps,
    actor,
    {
      purpose: "sign_contract",
      rentalId,
      rentalChangeId: null,
      template: ready.template,
      filled: ready.filled,
      refusal: async (tx, rental) => {
        if (!isContractSignable(rental.status)) {
          return "not_signable";
        }
        const [signed] = await tx
          .select({ id: issuedDocuments.id })
          .from(issuedDocuments)
          .where(and(eq(issuedDocuments.rentalId, rentalId), eq(issuedDocuments.kind, "contract")))
          .limit(1);
        return signed ? "already_signed" : null;
      },
    },
    clock,
  );
}

/**
 * Sends the Renter a change of terms to sign: the business's default
 * "Change of terms" template, with the change's own fields filled in.
 */
export async function sendChangeSigningLink(
  deps: LinkDependencies,
  actor: ActingUser,
  change: RentalChange,
  clock: RentalClock,
): Promise<SendSigningLinkResult> {
  const { rental, isRiseNoticed } = await withTenant(
    deps.database,
    actor.operatorId,
    async (tx) => ({
      rental: (
        await tx
          .select({ handedOverAt: rentals.handedOverAt })
          .from(rentals)
          .where(and(eq(rentals.id, change.rentalId), eq(rentals.operatorId, actor.operatorId)))
      )[0],
      isRiseNoticed: await isRiseNoticedNow(tx, actor.operatorId, change),
    }),
  );
  const ready = await filledFor(deps, actor, {
    kind: "change_of_terms",
    rentalId: change.rentalId,
    clock,
    change: changeFieldsOf(change, clock.timeZone, rental?.handedOverAt ?? null, isRiseNoticed),
  });
  if (ready.status !== "ready") {
    return ready;
  }
  return sendLinkFor(
    deps,
    actor,
    {
      purpose: "sign_change",
      rentalId: change.rentalId,
      rentalChangeId: change.id,
      template: ready.template,
      filled: ready.filled,
      refusal: async (tx, rental) => {
        const locked = await lockChange(tx, actor.operatorId, change.id);
        if (!locked) {
          return "not_signable";
        }
        const problem = await changeSigningProblemNow(
          tx,
          actor.operatorId,
          locked,
          rental,
          clock.now,
        );
        if (problem === "signed") {
          return "already_signed";
        }
        return problem ? "not_signable" : null;
      },
    },
    clock,
  );
}

/** Stops the rental's signing link working at once. */
export function cancelSigningLink(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  now: Date,
): Promise<"cancelled" | "none"> {
  return cancelRentalLink(database, actor, { rentalId, purpose: "sign_contract" }, now);
}

export interface SigningStatus {
  signed: { documentId: string; version: number; issuedAt: Date } | null;
  link: RenterLinkInPlay | null;
  /** What the live link was sent with, to check it still matches the rental. */
  sentPaper: SentPaperOfLink | null;
}

/** What a signing link was sent with: its template version and its text's fingerprint. */
export interface SentPaperOfLink {
  templateVersionId: string;
  contractFingerprint: string;
  sentAt: Date;
}

/** The sent-paper columns of a signing link, read with the link. */
export const SENT_PAPER_COLUMNS = {
  templateVersionId: renterLinks.templateVersionId,
  contractFingerprint: renterLinks.contractFingerprint,
};

export function sentPaperOf(link: {
  templateVersionId: string | null;
  contractFingerprint: string | null;
  sentAt: Date;
}): SentPaperOfLink | null {
  return link.templateVersionId && link.contractFingerprint
    ? {
        templateVersionId: link.templateVersionId,
        contractFingerprint: link.contractFingerprint,
        sentAt: link.sentAt,
      }
    : null;
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
      .select({ ...LINK_IN_PLAY_COLUMNS, ...SENT_PAPER_COLUMNS })
      .from(renterLinks)
      .where(
        and(
          eq(renterLinks.operatorId, operatorId),
          eq(renterLinks.rentalId, rentalId),
          eq(renterLinks.purpose, "sign_contract"),
          isNull(renterLinks.cancelledAt),
        ),
      )
      .limit(1);
    return {
      signed: signed ?? null,
      link: link ? linkInPlay(link, now) : null,
      sentPaper: link ? sentPaperOf(link) : null,
    };
  });
}
