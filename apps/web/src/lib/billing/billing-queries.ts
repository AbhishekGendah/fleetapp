import type { BillingDocumentKind, IssuedDocumentKind } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { billingDocuments, files, issuedDocuments } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { FileStorage } from "../storage/file-storage";

/** The kinds of fixed document the rental's Invoices card lists. */
export const BILLING_ISSUED_KINDS: readonly IssuedDocumentKind[] = [
  "invoice",
  "credit_note",
  "receipt",
  "statement",
];

export interface BillingDocumentSummary {
  /** The issued document (its PDF). */
  issuedDocumentId: string;
  kind: BillingDocumentKind | "statement";
  /** None for a statement. */
  numberText: string | null;
  isTaxDocument: boolean;
  totalCents: number | null;
  gstCents: number | null;
  issuedAt: Date;
}

/** A rental's invoices, credit notes, receipts and statements, newest first. */
export async function listBillingDocuments(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
): Promise<BillingDocumentSummary[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        issuedDocumentId: issuedDocuments.id,
        issuedKind: issuedDocuments.kind,
        issuedAt: issuedDocuments.issuedAt,
        kind: billingDocuments.kind,
        numberText: billingDocuments.numberText,
        isTaxDocument: billingDocuments.isTaxDocument,
        totalCents: billingDocuments.totalCents,
        gstCents: billingDocuments.gstCents,
      })
      .from(issuedDocuments)
      .leftJoin(
        billingDocuments,
        and(
          eq(billingDocuments.issuedDocumentId, issuedDocuments.id),
          eq(billingDocuments.operatorId, issuedDocuments.operatorId),
        ),
      )
      .where(
        and(
          eq(issuedDocuments.operatorId, operatorId),
          eq(issuedDocuments.rentalId, rentalId),
          inArray(issuedDocuments.kind, [...BILLING_ISSUED_KINDS]),
        ),
      )
      .orderBy(desc(issuedDocuments.issuedAt)),
  );
  return rows.map((row) => ({
    issuedDocumentId: row.issuedDocumentId,
    kind: row.kind ?? "statement",
    numberText: row.numberText,
    isTaxDocument: row.isTaxDocument ?? false,
    totalCents: row.totalCents,
    gstCents: row.gstCents,
    issuedAt: row.issuedAt,
  }));
}

/**
 * One of the rental's billing documents with its PDF's bytes, to email
 * again; null if it is not the business's, or not a billing document.
 */
export async function loadBillingDocumentPdf(
  deps: { database: AnyDatabase; storage: FileStorage },
  operatorId: string,
  target: { rentalId: string; issuedDocumentId: string },
): Promise<(BillingDocumentSummary & { pdf: Uint8Array }) | null> {
  const summaries = await listBillingDocuments(deps.database, operatorId, target.rentalId);
  const summary = summaries.find((item) => item.issuedDocumentId === target.issuedDocumentId);
  if (!summary) {
    return null;
  }
  const [file] = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({ storageArea: files.storageArea, objectKey: files.objectKey })
      .from(issuedDocuments)
      .innerJoin(
        files,
        and(eq(files.id, issuedDocuments.fileId), eq(files.operatorId, issuedDocuments.operatorId)),
      )
      .where(eq(issuedDocuments.id, summary.issuedDocumentId)),
  );
  const stored = file ? await deps.storage.inspect(file.storageArea, file.objectKey) : null;
  if (!file || !stored) {
    return null;
  }
  const pdf = await deps.storage.readStart(
    file.storageArea,
    file.objectKey,
    stored.sizeBytes,
    stored.version,
  );
  return { ...summary, pdf };
}
