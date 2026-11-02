import { randomUUID } from "node:crypto";

import {
  buildFileKey,
  FILE_CONTENT_TYPES,
  FILE_PURPOSE_RULES,
  type IssuedDocumentKind,
} from "@fleetapp/core";
import { documentFingerprint } from "@fleetapp/core/server";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  files,
  issuedDocuments,
  rentals,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, isNotNull } from "drizzle-orm";

import { recordActivity } from "@fleetapp/db/activity";
import type { FileDependencies } from "../files/stored-files";

const PURPOSE = "issued_document";
const AREA = FILE_PURPOSE_RULES[PURPOSE].area;

/** Who issued it: a User, a Renter's link (they signed), or the app on its own. */
export type IssuingActor =
  | { operatorId: string; userId: string }
  | { operatorId: string; linkId: string }
  | { operatorId: string };

export interface IssueRequest {
  rentalId: string;
  kind: IssuedDocumentKind;
  /** The template version it was made from; none for a report. */
  templateVersionId: string | null;
  /** The handover or return checklist a report was made from. */
  inspectionId?: string;
  pdf: Uint8Array;
  /**
   * Runs in the same transaction that records the document, e.g. to keep the
   * signing evidence with it: neither is ever kept without the other.
   */
  onIssued?: (tx: AnyTransaction, documentId: string) => Promise<void>;
}

export type IssueResult =
  | { status: "issued"; documentId: string; version: number; sha256: string }
  | { status: "not_found" | "too_big" };

function userIdOf(actor: IssuingActor): string | null {
  return "userId" in actor ? actor.userId : null;
}

function logActorOf(actor: IssuingActor): {
  type: "user" | "renter_link" | "system";
  id: string | null;
} {
  if ("userId" in actor) {
    return { type: "user", id: actor.userId };
  }
  return "linkId" in actor
    ? { type: "renter_link", id: actor.linkId }
    : { type: "system", id: null };
}

async function nextVersion(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
  kind: IssuedDocumentKind,
): Promise<number> {
  const [latest] = await tx
    .select({ version: issuedDocuments.version })
    .from(issuedDocuments)
    .where(
      and(
        eq(issuedDocuments.operatorId, operatorId),
        eq(issuedDocuments.rentalId, rentalId),
        eq(issuedDocuments.kind, kind),
      ),
    )
    .orderBy(desc(issuedDocuments.version))
    .limit(1);
  return (latest?.version ?? 0) + 1;
}

/**
 * Issues a fixed document for a rental (rule 12): the PDF is stored once,
 * never to be changed, and recorded with its SHA-256 fingerprint as the next
 * version of its kind. The file is recorded first and confirmed only once the
 * PDF is safely stored, so a failed save leaves an abandoned upload that the
 * nightly clean-up removes, never a document without its PDF.
 */
export async function issueDocument(
  deps: FileDependencies,
  actor: IssuingActor,
  request: IssueRequest,
): Promise<IssueResult> {
  if (request.pdf.byteLength > FILE_PURPOSE_RULES[PURPOSE].maxBytes) {
    return { status: "too_big" };
  }
  const fileId = randomUUID();
  const objectKey = buildFileKey(actor.operatorId, PURPOSE, fileId);
  const isRental = await withTenant(deps.database, actor.operatorId, async (tx) => {
    const [rental] = await tx
      .select({ id: rentals.id })
      .from(rentals)
      .where(and(eq(rentals.id, request.rentalId), eq(rentals.operatorId, actor.operatorId)));
    if (!rental) {
      return false;
    }
    await tx.insert(files).values({
      id: fileId,
      operatorId: actor.operatorId,
      purpose: PURPOSE,
      storageArea: AREA,
      objectKey,
      contentType: FILE_CONTENT_TYPES.pdf,
      sizeBytes: request.pdf.byteLength,
    });
    return true;
  });
  if (!isRental) {
    return { status: "not_found" };
  }

  await deps.storage.save(AREA, objectKey, request.pdf, FILE_CONTENT_TYPES.pdf);
  const sha256 = documentFingerprint(request.pdf);

  return withTenant(deps.database, actor.operatorId, async (tx) => {
    // Locks the rental so two documents of one kind cannot take the same number.
    await tx
      .select({ id: rentals.id })
      .from(rentals)
      .where(eq(rentals.id, request.rentalId))
      .for("update");
    const version = await nextVersion(tx, actor.operatorId, request.rentalId, request.kind);
    await tx
      .update(files)
      .set({ confirmedAt: deps.now() })
      .where(and(eq(files.id, fileId), eq(files.operatorId, actor.operatorId)));
    const [document] = await tx
      .insert(issuedDocuments)
      .values({
        operatorId: actor.operatorId,
        rentalId: request.rentalId,
        kind: request.kind,
        version,
        templateVersionId: request.templateVersionId,
        inspectionId: request.inspectionId ?? null,
        fileId,
        sha256,
        issuedByUserId: userIdOf(actor),
        issuedAt: deps.now(),
      })
      .returning({ id: issuedDocuments.id });
    if (!document) {
      throw new Error("The document was not saved.");
    }
    await recordActivity(tx, {
      operatorId: actor.operatorId,
      actor: logActorOf(actor),
      entityType: ACTIVITY_ENTITY_TYPES.issuedDocument,
      entityId: document.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: { kind: request.kind, version, rentalId: request.rentalId, sha256 },
    });
    await request.onIssued?.(tx, document.id);
    return { status: "issued", documentId: document.id, version, sha256 };
  });
}

export interface IssuedDocumentSummary {
  id: string;
  kind: IssuedDocumentKind;
  version: number;
  sha256: string;
  issuedAt: Date;
}

/** A rental's issued documents, newest first. */
export async function listIssuedDocuments(
  database: FileDependencies["database"],
  operatorId: string,
  rentalId: string,
): Promise<IssuedDocumentSummary[]> {
  return withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: issuedDocuments.id,
        kind: issuedDocuments.kind,
        version: issuedDocuments.version,
        sha256: issuedDocuments.sha256,
        issuedAt: issuedDocuments.issuedAt,
      })
      .from(issuedDocuments)
      .where(
        and(eq(issuedDocuments.operatorId, operatorId), eq(issuedDocuments.rentalId, rentalId)),
      )
      .orderBy(desc(issuedDocuments.issuedAt)),
  );
}

/** A 5-minute link to an issued document's PDF, or null if it is not the Operator's. */
export async function openIssuedDocument(
  deps: Pick<FileDependencies, "database" | "storage">,
  operatorId: string,
  documentId: string,
  downloadName: string,
): Promise<string | null> {
  const [document] = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({ objectKey: files.objectKey })
      .from(issuedDocuments)
      .innerJoin(
        files,
        and(eq(files.id, issuedDocuments.fileId), eq(files.operatorId, issuedDocuments.operatorId)),
      )
      .where(
        and(
          eq(issuedDocuments.id, documentId),
          eq(issuedDocuments.operatorId, operatorId),
          isNotNull(files.confirmedAt),
        ),
      ),
  );
  return document ? deps.storage.createViewUrl(AREA, document.objectKey, downloadName) : null;
}
