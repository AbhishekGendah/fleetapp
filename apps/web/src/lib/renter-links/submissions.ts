import { LICENCE_SIDES, MAXIMUM_LINK_ADDRESS_SEARCHES, type LicenceSide } from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  files,
  renterLinks,
  renterSubmissions,
  renters,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import type { PlannedFile } from "../files/car-files";
import {
  requestUpload,
  type FileDependencies,
  type UploadRequestResult,
} from "../files/stored-files";
import { renterFormValues, type RenterFormValues } from "../renters/renter-input";
import type { DetailsInput } from "./details-form-input";
import type { LinkVisit } from "./link-visits";
import { loadSentBack } from "./reviews";

/** The link acting: never a User, and only ever within its own Operator (rule 3). */
function linkActor(visit: LinkVisit) {
  return { operatorId: visit.operatorId, linkId: visit.linkId };
}

/** The photos sent through the link and not yet with a submission, by side. */
async function unsentPhotos(tx: AnyTransaction, visit: LinkVisit) {
  return tx
    .select({ id: files.id, side: files.licenceSide })
    .from(files)
    .where(
      and(
        eq(files.operatorId, visit.operatorId),
        eq(files.renterLinkId, visit.linkId),
        eq(files.purpose, "renter_submitted_scan"),
        isNull(files.submissionId),
        isNotNull(files.confirmedAt),
        isNull(files.deletedAt),
      ),
    );
}

/** One Renter of one Operator: always the signed-in User's or the link's own (rule 1). */
interface RenterRef {
  operatorId: string;
  renterId: string;
}

async function waitingSubmission(tx: AnyTransaction, renter: RenterRef) {
  const [waiting] = await tx
    .select({ id: renterSubmissions.id, sentAt: renterSubmissions.createdAt })
    .from(renterSubmissions)
    .where(
      and(
        eq(renterSubmissions.operatorId, renter.operatorId),
        eq(renterSubmissions.renterId, renter.renterId),
        eq(renterSubmissions.status, "waiting"),
      ),
    );
  return waiting ?? null;
}

/** When the Renter sent details still waiting for the Operator's review, or null. */
export async function loadWaitingSubmission(
  database: AnyDatabase,
  renter: RenterRef,
): Promise<{ sentAt: Date } | null> {
  const waiting = await withTenant(database, renter.operatorId, (tx) =>
    waitingSubmission(tx, renter),
  );
  return waiting ? { sentAt: waiting.sentAt } : null;
}

export type FormStart =
  | { status: "waiting" }
  | {
      status: "open";
      values: RenterFormValues;
      photos: Record<LicenceSide, boolean>;
      /** The Operator's note when what they last sent came back for a change. */
      sentBackNote: string | null;
    };

/**
 * Where the Renter's form starts: their details as on file (never the
 * licence or its scans, rule 26), and which photos they have already sent.
 * Or "waiting" once they have sent it, until the Operator reviews it.
 */
export async function loadFormStart(database: AnyDatabase, visit: LinkVisit): Promise<FormStart> {
  return withTenant(database, visit.operatorId, async (tx) => {
    if (await waitingSubmission(tx, visit)) {
      return { status: "waiting" as const };
    }
    const [renter] = await tx
      .select()
      .from(renters)
      .where(and(eq(renters.id, visit.renterId), eq(renters.operatorId, visit.operatorId)));
    if (!renter) {
      throw new Error("The link's Renter was not found.");
    }
    const sent = await unsentPhotos(tx, visit);
    const sentBack = await loadSentBack(tx, visit.operatorId, visit.renterId);
    return {
      status: "open" as const,
      // After a send-back, what they sent last (not yet on file) is theirs to fix.
      values: renterFormValues(sentBack?.details ?? renter),
      sentBackNote: sentBack?.note ?? null,
      photos: Object.fromEntries(
        LICENCE_SIDES.map((side) => [side, sent.some((photo) => photo.side === side)]),
      ) as Record<LicenceSide, boolean>,
    };
  });
}

/** "not_found": the details were already sent, so no more photos go with them. */
export type LinkPhotoStart =
  Extract<UploadRequestResult, { status: "allowed" | "refused" }> | { status: "not_found" };

class AlreadySentError extends Error {
  constructor() {
    super("The details were already sent.");
    this.name = "AlreadySentError";
  }
}

/** Starts sending one licence photo: identity storage, replacing that side's earlier photo. */
export async function startLinkPhotoUpload(
  deps: FileDependencies,
  visit: LinkVisit,
  side: LicenceSide,
  planned: PlannedFile,
): Promise<LinkPhotoStart> {
  return requestUpload(deps, linkActor(visit), {
    purpose: "renter_submitted_scan",
    ...planned,
    links: async (tx) => {
      if (await waitingSubmission(tx, visit)) {
        // Undoes the transaction: nothing is recorded.
        throw new AlreadySentError();
      }
      return { renterLinkId: visit.linkId, licenceSide: side };
    },
  }).catch((error: unknown) => {
    if (error instanceof AlreadySentError) {
      return { status: "not_found" as const };
    }
    throw error;
  });
}

export type SubmitResult = "sent" | "photos_missing" | "already_sent";

/**
 * Sends the Renter's details and licence, with both photos, for the
 * Operator to review. Nothing on the Renter's record changes (decision 4).
 */
export async function submitDetails(
  database: AnyDatabase,
  visit: LinkVisit,
  input: DetailsInput,
): Promise<SubmitResult> {
  return withTenant(database, visit.operatorId, async (tx) => {
    // One step at a time per link, so a double tap cannot send twice.
    await tx
      .select({ id: renterLinks.id })
      .from(renterLinks)
      .where(and(eq(renterLinks.id, visit.linkId), eq(renterLinks.operatorId, visit.operatorId)))
      .for("update");
    if (await waitingSubmission(tx, visit)) {
      return "already_sent";
    }
    const photos = await unsentPhotos(tx, visit);
    if (!LICENCE_SIDES.every((side) => photos.some((photo) => photo.side === side))) {
      return "photos_missing";
    }
    const [submission] = await tx
      .insert(renterSubmissions)
      .values({
        operatorId: visit.operatorId,
        renterId: visit.renterId,
        linkId: visit.linkId,
        ...input.details,
        ...input.licence,
      })
      .returning({ id: renterSubmissions.id });
    if (!submission) {
      throw new Error("The details were not saved.");
    }
    await tx
      .update(files)
      .set({ submissionId: submission.id })
      .where(
        and(
          eq(files.operatorId, visit.operatorId),
          inArray(
            files.id,
            photos.map((photo) => photo.id),
          ),
        ),
      );
    // What was sent stays out of the log; the submission itself holds it.
    await recordActivity(tx, {
      operatorId: visit.operatorId,
      actor: { type: "renter_link", id: visit.linkId },
      entityType: ACTIVITY_ENTITY_TYPES.renter,
      entityId: visit.renterId,
      action: ACTIVITY_ACTIONS.submitted,
    });
    return "sent";
  });
}

/** Counts one address search for the link; false once it has had its 50. */
export async function countAddressSearch(
  database: AnyDatabase,
  visit: LinkVisit,
): Promise<boolean> {
  const counted = await withTenant(database, visit.operatorId, (tx) =>
    tx
      .update(renterLinks)
      .set({ addressSearches: sql`${renterLinks.addressSearches} + 1` })
      .where(
        and(
          eq(renterLinks.id, visit.linkId),
          eq(renterLinks.operatorId, visit.operatorId),
          lt(renterLinks.addressSearches, MAXIMUM_LINK_ADDRESS_SEARCHES),
        ),
      )
      .returning({ id: renterLinks.id }),
  );
  return counted.length > 0;
}
