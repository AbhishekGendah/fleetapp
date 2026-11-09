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
import { ROW_LOCK } from "@fleetapp/db/row-lock";
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

export function logActorOf(actor: IssuingActor): {
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

/** A document's PDF stored and its file recorded, waiting to be issued in a transaction. */
export interface StoredDocument {
  fileId: string;
  sha256: string;
  request: Omit<IssueRequest, "onIssued">;
}

/** A document's file, recorded before its PDF is stored, so a failed save is cleaned up. */
export interface ReservedDocumentFile {
  fileId: string;
  objectKey: string;
}

/**
 * Records the file a rental's document will be stored under, unconfirmed:
 * if the PDF is never stored or the document never issued, the nightly
 * clean-up removes it as an abandoned upload. Null if not the business's rental.
 */
export async function reserveDocumentFile(
  deps: FileDependencies,
  actor: IssuingActor,
  rentalId: string,
  sizeBytes: number,
): Promise<ReservedDocumentFile | null> {
  const fileId = randomUUID();
  const objectKey = buildFileKey(actor.operatorId, PURPOSE, fileId);
  const isRental = await withTenant(deps.database, actor.operatorId, async (tx) => {
    const [rental] = await tx
      .select({ id: rentals.id })
      .from(rentals)
      .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, actor.operatorId)));
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
      sizeBytes,
    });
    return true;
  });
  return isRental ? { fileId, objectKey } : null;
}

/** Stores the PDF, never to be changed, under its reserved file. */
export async function saveReservedPdf(
  deps: Pick<FileDependencies, "storage">,
  reserved: ReservedDocumentFile,
  request: Omit<IssueRequest, "onIssued">,
): Promise<StoredDocument | { status: "too_big" }> {
  if (request.pdf.byteLength > FILE_PURPOSE_RULES[PURPOSE].maxBytes) {
    return { status: "too_big" };
  }
  await deps.storage.save(AREA, reserved.objectKey, request.pdf, FILE_CONTENT_TYPES.pdf);
  return { fileId: reserved.fileId, sha256: documentFingerprint(request.pdf), request };
}

/**
 * The first half of issuing (rule 12): the PDF is stored once, never to be
 * changed, under a file recorded first and confirmed only when it is issued,
 * so a failed save leaves an abandoned upload that the nightly clean-up
 * removes, never a document without its PDF.
 */
export async function storeDocumentPdf(
  deps: FileDependencies,
  actor: IssuingActor,
  request: Omit<IssueRequest, "onIssued">,
): Promise<StoredDocument | { status: "not_found" | "too_big" }> {
  if (request.pdf.byteLength > FILE_PURPOSE_RULES[PURPOSE].maxBytes) {
    return { status: "too_big" };
  }
  const reserved = await reserveDocumentFile(deps, actor, request.rentalId, request.pdf.byteLength);
  return reserved ? saveReservedPdf(deps, reserved, request) : { status: "not_found" };
}

/**
 * The second half, inside the caller's transaction: the stored PDF is
 * recorded with its SHA-256 fingerprint as the next version of its kind.
 * The rental is locked so two documents of one kind cannot take the same
 * number.
 */
export async function recordIssuedDocument(
  tx: AnyTransaction,
  deps: Pick<FileDependencies, "now">,
  actor: IssuingActor,
  stored: StoredDocument,
): Promise<{ documentId: string; version: number; sha256: string }> {
  const { request } = stored;
  await tx
    .select({ id: rentals.id })
    .from(rentals)
    .where(eq(rentals.id, request.rentalId))
    .for(ROW_LOCK);
  const version = await nextVersion(tx, actor.operatorId, request.rentalId, request.kind);
  await tx
    .update(files)
    .set({ confirmedAt: deps.now(), sizeBytes: request.pdf.byteLength })
    .where(and(eq(files.id, stored.fileId), eq(files.operatorId, actor.operatorId)));
  const [document] = await tx
    .insert(issuedDocuments)
    .values({
      operatorId: actor.operatorId,
      rentalId: request.rentalId,
      kind: request.kind,
      version,
      templateVersionId: request.templateVersionId,
      inspectionId: request.inspectionId ?? null,
      fileId: stored.fileId,
      sha256: stored.sha256,
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
    valuesAfter: { kind: request.kind, version, rentalId: request.rentalId, sha256: stored.sha256 },
  });
  return { documentId: document.id, version, sha256: stored.sha256 };
}

/** Issues a fixed document for a rental (rule 12): stored, then recorded with `onIssued`. */
export async function issueDocument(
  deps: FileDependencies,
  actor: IssuingActor,
  request: IssueRequest,
): Promise<IssueResult> {
  const { onIssued, ...toStore } = request;
  const stored = await storeDocumentPdf(deps, actor, toStore);
  if ("status" in stored) {
    return stored;
  }
  return withTenant(deps.database, actor.operatorId, async (tx) => {
    const issued = await recordIssuedDocument(tx, deps, actor, stored);
    await onIssued?.(tx, issued.documentId);
    return { status: "issued", ...issued };
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
