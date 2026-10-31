import { describeErrorForLog, LICENCE_SIDES, type LicenceSide } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, files, renterLinks, renterSubmissions } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { renderRenterDetailsSentBackEmail } from "@fleetapp/email";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import type { ActingUser } from "../acting-user";
import {
  logFile,
  markScansDeleted,
  openLicenceImage,
  type FileDependencies,
} from "../files/stored-files";
import type { LicenceInput } from "../renters/licence-input";
import {
  applyLicence,
  findLicenceHolder,
  isLicenceOnFileError,
  type LicenceOnFile,
} from "../renters/licence-records";
import type { RenterInput } from "../renters/renter-input";
import {
  applyRenterDetails,
  lockCurrentRenter,
  logRenterActivity,
} from "../renters/renter-records";
import type { LinkDependencies } from "./details-links";
import { loadLinkSender } from "./link-email";

type SubmissionRow = typeof renterSubmissions.$inferSelect;

export interface SubmittedPhoto {
  id: string;
  contentType: string;
}

/** What the Renter sent, for the Operator to compare with what is on file. */
export interface SubmissionForReview {
  id: string;
  sentAt: Date;
  details: RenterInput;
  licence: LicenceInput;
  photos: Record<LicenceSide, SubmittedPhoto | null>;
}

function detailsOf(submission: SubmissionRow): RenterInput {
  return {
    fullName: submission.fullName,
    preferredName: submission.preferredName,
    phone: submission.phone,
    email: submission.email,
    dateOfBirth: submission.dateOfBirth,
    residentialAddress: submission.residentialAddress,
    postalAddress: submission.postalAddress,
    emergencyContactName: submission.emergencyContactName,
    emergencyContactPhone: submission.emergencyContactPhone,
    emergencyContactRelationship: submission.emergencyContactRelationship,
  };
}

function licenceOf(submission: SubmissionRow): LicenceInput {
  return {
    licenceIssuedIn: submission.licenceIssuedIn,
    licenceCountry: submission.licenceCountry,
    licenceNumber: submission.licenceNumber,
    licenceClass: submission.licenceClass,
    licenceType: submission.licenceType,
    licenceExpiresOn: submission.licenceExpiresOn,
  };
}

/** The Renter's submission waiting for review, locked for this transaction when `shouldLock`. */
async function findWaiting(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
  shouldLock: boolean,
): Promise<SubmissionRow | undefined> {
  const query = tx
    .select()
    .from(renterSubmissions)
    .where(
      and(
        eq(renterSubmissions.operatorId, operatorId),
        eq(renterSubmissions.renterId, renterId),
        eq(renterSubmissions.status, "waiting"),
      ),
    );
  const [found] = shouldLock ? await query.for("update") : await query;
  return found;
}

/** The submission's photos still held: confirmed and not removed. */
function photosOf(tx: AnyTransaction, operatorId: string, submissionId: string) {
  return tx
    .select({ id: files.id, side: files.licenceSide, contentType: files.contentType })
    .from(files)
    .where(
      and(
        eq(files.operatorId, operatorId),
        eq(files.submissionId, submissionId),
        isNotNull(files.confirmedAt),
        isNull(files.deletedAt),
      ),
    );
}

/** What the Renter sent and is waiting for review, or null. Listing the photos is not looking at them. */
export async function loadSubmissionForReview(
  database: FileDependencies["database"],
  operatorId: string,
  renterId: string,
): Promise<SubmissionForReview | null> {
  return withTenant(database, operatorId, async (tx) => {
    const submission = await findWaiting(tx, operatorId, renterId, false);
    if (!submission) {
      return null;
    }
    const photos = await photosOf(tx, operatorId, submission.id);
    const photoOf = (side: LicenceSide): SubmittedPhoto | null => {
      const photo = photos.find((each) => each.side === side);
      return photo ? { id: photo.id, contentType: photo.contentType } : null;
    };
    return {
      id: submission.id,
      sentAt: submission.createdAt,
      details: detailsOf(submission),
      licence: licenceOf(submission),
      photos: Object.fromEntries(LICENCE_SIDES.map((side) => [side, photoOf(side)])) as Record<
        LicenceSide,
        SubmittedPhoto | null
      >,
    };
  });
}

/** A 5-minute link to a photo the Renter sent, while it waits for review. Every look is logged (rule 8). */
export function openSubmittedPhoto(
  deps: FileDependencies,
  actor: ActingUser,
  renterId: string,
  fileId: string,
): Promise<string | null> {
  const waitingForRenter = deps.database
    .select({ id: renterSubmissions.id })
    .from(renterSubmissions)
    .where(
      and(
        eq(renterSubmissions.operatorId, actor.operatorId),
        eq(renterSubmissions.renterId, renterId),
        eq(renterSubmissions.status, "waiting"),
      ),
    );
  return openLicenceImage(deps, actor, {
    fileId,
    purpose: "renter_submitted_scan",
    which: and(
      inArray(files.submissionId, waitingForRenter),
      isNotNull(files.confirmedAt),
      isNull(files.deletedAt),
    ),
    namePrefix: "Licence photo sent",
  });
}

/** The two photos become the Renter's licence scans; the old scans go to the 30-day bin. */
async function adoptPhotosAsScans(
  tx: AnyTransaction,
  actor: ActingUser,
  now: Date,
  renterId: string,
  submissionId: string,
): Promise<void> {
  const photos = await photosOf(tx, actor.operatorId, submissionId);
  if (photos.length === 0) {
    return;
  }
  await markScansDeleted(tx, actor, now, eq(files.renterId, renterId));
  const photoIds = photos.map((photo) => photo.id);
  await tx
    .update(files)
    .set({ purpose: "renter_licence_scan", renterId })
    .where(and(eq(files.operatorId, actor.operatorId), inArray(files.id, photoIds)));
  for (const photoId of photoIds) {
    await logFile(tx, actor, photoId, "uploaded", "renter_licence_scan");
  }
}

function markReviewed(
  tx: AnyTransaction,
  actor: ActingUser,
  submissionId: string,
  now: Date,
  review: { status: "approved" } | { status: "sent_back"; reviewNote: string },
) {
  return tx
    .update(renterSubmissions)
    .set({ ...review, reviewedByUserId: actor.userId, reviewedAt: now, updatedAt: now })
    .where(
      and(
        eq(renterSubmissions.id, submissionId),
        eq(renterSubmissions.operatorId, actor.operatorId),
      ),
    );
}

export type ApproveResult = "approved" | "not_found" | LicenceOnFile;

/**
 * Copies what the Renter sent onto their record, exactly as if the User had
 * typed it (each change logged, never its value), and the photos become the
 * licence scans. Refused, with nothing changed, if another Renter has that
 * licence. `submissionId` must still be the one waiting, so a stale page
 * cannot approve something else.
 */
export async function approveSubmission(
  deps: FileDependencies,
  actor: ActingUser,
  renterId: string,
  submissionId: string,
): Promise<ApproveResult> {
  const now = deps.now();
  let licence: LicenceInput | null = null;
  try {
    return await withTenant(deps.database, actor.operatorId, async (tx) => {
      const before = await lockCurrentRenter(tx, actor.operatorId, renterId);
      const submission = before && (await findWaiting(tx, actor.operatorId, renterId, true));
      if (!before || submission?.id !== submissionId) {
        return "not_found";
      }
      licence = licenceOf(submission);
      await applyRenterDetails(tx, actor, before, detailsOf(submission));
      await applyLicence(tx, actor, before, licence);
      await adoptPhotosAsScans(tx, actor, now, renterId, submissionId);
      await markReviewed(tx, actor, submissionId, now, { status: "approved" });
      await logRenterActivity(tx, actor, renterId, ACTIVITY_ACTIONS.approved);
      return "approved";
    });
  } catch (error) {
    if (licence && isLicenceOnFileError(error)) {
      return findLicenceHolder(deps.database, actor.operatorId, licence);
    }
    throw error;
  }
}

/** "link_ended": the Renter has no working details link to correct it with; send a new one first. */
export type SendBackResult =
  { status: "sent_back"; isEmailed: boolean } | { status: "link_ended" } | { status: "not_found" };

/**
 * Returns what the Renter sent, with the Operator's note, for them to fix
 * through the same link while it works. Their photos go back to them too,
 * so they only retake one if asked. The note is emailed, never logged.
 */
export async function sendBackSubmission(
  deps: Pick<LinkDependencies, "database" | "emailSender" | "now" | "describeDay">,
  actor: ActingUser,
  renterId: string,
  input: { submissionId: string; note: string },
): Promise<SendBackResult> {
  const now = deps.now();
  const outcome = await withTenant(deps.database, actor.operatorId, async (tx) => {
    const submission = await findWaiting(tx, actor.operatorId, renterId, true);
    if (submission?.id !== input.submissionId) {
      return { status: "not_found" as const };
    }
    const [link] = await tx
      .select()
      .from(renterLinks)
      .where(
        and(
          eq(renterLinks.operatorId, actor.operatorId),
          eq(renterLinks.renterId, renterId),
          eq(renterLinks.purpose, "details_form"),
          isNull(renterLinks.cancelledAt),
        ),
      )
      .orderBy(desc(renterLinks.createdAt))
      .limit(1);
    // The Renter corrects it through the details link they have now: the one
    // they sent from, or a newer one the Operator sent since.
    if (!link || link.expiresAt <= now) {
      return { status: "link_ended" as const };
    }
    await markReviewed(tx, actor, submission.id, now, {
      status: "sent_back",
      reviewNote: input.note,
    });
    await tx
      .update(files)
      .set({ submissionId: null })
      .where(and(eq(files.operatorId, actor.operatorId), eq(files.submissionId, submission.id)));
    await logRenterActivity(tx, actor, renterId, ACTIVITY_ACTIONS.sentBack);
    return {
      status: "sent_back" as const,
      link,
      sender: await loadLinkSender(tx, actor.operatorId),
    };
  });
  if (outcome.status !== "sent_back") {
    return outcome;
  }
  return { status: "sent_back", isEmailed: await emailSentBack(deps, outcome, input.note) };
}

async function emailSentBack(
  deps: Pick<LinkDependencies, "emailSender" | "describeDay">,
  outcome: {
    link: typeof renterLinks.$inferSelect;
    sender: Awaited<ReturnType<typeof loadLinkSender>>;
  },
  note: string,
): Promise<boolean> {
  try {
    await deps.emailSender.send(
      await renderRenterDetailsSentBackEmail({
        to: outcome.link.sentToEmail,
        operatorName: outcome.sender.operatorName,
        replyTo: outcome.sender.replyTo,
        note,
        linkWorksUntil: deps.describeDay(outcome.link.expiresAt),
      }),
    );
    return true;
  } catch (error) {
    // Sent back all the same: the Renter sees the note when they open the link.
    console.error("Emailing a sent-back note failed", describeErrorForLog(error));
    return false;
  }
}

/** The Operator's latest note if what the Renter last sent came back to them, with what they sent. */
export async function loadSentBack(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<{ note: string; details: RenterInput } | null> {
  const [latest] = await tx
    .select()
    .from(renterSubmissions)
    .where(
      and(eq(renterSubmissions.operatorId, operatorId), eq(renterSubmissions.renterId, renterId)),
    )
    .orderBy(desc(renterSubmissions.createdAt))
    .limit(1);
  if (latest?.status !== "sent_back" || latest.reviewNote === null) {
    return null;
  }
  return { note: latest.reviewNote, details: detailsOf(latest) };
}
