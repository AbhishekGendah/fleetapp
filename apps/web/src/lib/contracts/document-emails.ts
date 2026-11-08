import {
  DOCUMENT_EMAIL_RECIPIENTS,
  documentEmailState,
  formatDateTimeInTimeZone,
  type DocumentEmailState,
} from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  documentEmails,
  files,
  inspections,
  issuedDocuments,
  rentals,
  renters,
  vehicles,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { COPIED_DOCUMENT_KINDS, type CopiedDocumentKind, type EmailSender } from "@fleetapp/email";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import type { FileDependencies } from "../files/stored-files";
import { readStoredFile } from "../files/read-stored-file";
import { emailDocumentCopies } from "./document-copies";
import { rentalSummaryText } from "./signing-links";

/** How each copied document is named in its email's attachment. */
const COPY_TITLES: Readonly<Record<CopiedDocumentKind, string>> = {
  contract: "Rental contract",
  change_of_terms: "Change of terms",
  handover_report: "Handover report",
  return_report: "Return report",
  swap_form: "Car swap",
};

/** Issued documents are always stored in the general area (never the identity one). */
const DOCUMENT_AREA = "general";

/** What each document's copies came to, from every try (review G7-1, G9-9). */
export async function loadDocumentEmailStates(
  database: AnyDatabase,
  operatorId: string,
  documentIds: readonly string[],
): Promise<ReadonlyMap<string, DocumentEmailState>> {
  if (documentIds.length === 0) {
    return new Map();
  }
  const tries = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        documentId: documentEmails.documentId,
        recipient: documentEmails.recipient,
        outcome: documentEmails.outcome,
      })
      .from(documentEmails)
      .where(
        and(
          eq(documentEmails.operatorId, operatorId),
          inArray(documentEmails.documentId, [...documentIds]),
        ),
      )
      .orderBy(asc(documentEmails.triedAt)),
  );
  return new Map(
    documentIds.map((id) => [
      id,
      documentEmailState(tries.filter((attempt) => attempt.documentId === id)),
    ]),
  );
}

/** The papers a business's driver signs for the car on the Operator's phone (rule 15). */
function isChecklistCopy(kind: CopiedDocumentKind): boolean {
  return kind === "handover_report" || kind === "return_report" || kind === "swap_form";
}

function isCopiedKind(kind: string): kind is CopiedDocumentKind {
  return COPIED_DOCUMENT_KINDS.some((copied) => copied === kind);
}

/**
 * Who signed for the car on a report (rule 15): the driver of the possession
 * its checklist started or ended, else the rental's driver (a swap form).
 */
const documentDriverName = sql<string | null>`(
  select "driver"."full_name" from "renters" "driver"
  where "driver"."operator_id" = "rentals"."operator_id"
    and "driver"."id" = coalesce(
      (select "held"."driver_id" from "possessions" "held"
        where "held"."operator_id" = "issued_documents"."operator_id"
          and ("held"."handover_inspection_id" = "issued_documents"."inspection_id"
            or "held"."return_inspection_id" = "issued_documents"."inspection_id")
        order by "held"."started_at" desc limit 1),
      "rentals"."driver_id")
)`;

/** The document and who it goes to now: the Renter's email as it is today, and its car. */
async function loadResendable(database: AnyDatabase, operatorId: string, documentId: string) {
  const [row] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        kind: issuedDocuments.kind,
        issuedAt: issuedDocuments.issuedAt,
        objectKey: files.objectKey,
        renterName: renters.fullName,
        renterKind: renters.kind,
        // A business's copy greets its contact, whose email it is.
        greetingName: sql<string>`coalesce(${renters.contactName}, ${renters.fullName})`,
        driverName: documentDriverName,
        renterEmail: renters.email,
        rentalVehicleId: rentals.vehicleId,
        inspectionVehicleId: inspections.vehicleId,
      })
      .from(issuedDocuments)
      .innerJoin(
        files,
        and(eq(files.id, issuedDocuments.fileId), eq(files.operatorId, issuedDocuments.operatorId)),
      )
      .innerJoin(
        rentals,
        and(
          eq(rentals.id, issuedDocuments.rentalId),
          eq(rentals.operatorId, issuedDocuments.operatorId),
        ),
      )
      .innerJoin(
        renters,
        and(eq(renters.id, rentals.renterId), eq(renters.operatorId, rentals.operatorId)),
      )
      .leftJoin(
        inspections,
        and(
          eq(inspections.id, issuedDocuments.inspectionId),
          eq(inspections.operatorId, issuedDocuments.operatorId),
        ),
      )
      .where(
        and(
          eq(issuedDocuments.id, documentId),
          eq(issuedDocuments.operatorId, operatorId),
          isNotNull(files.confirmedAt),
        ),
      ),
  );
  if (!row) {
    return null;
  }
  // A report names its own checklist's car; anything else, the rental's car now.
  const [car] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ rego: vehicles.rego, make: vehicles.make, model: vehicles.model })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.id, row.inspectionVehicleId ?? row.rentalVehicleId),
          eq(vehicles.operatorId, operatorId),
        ),
      ),
  );
  return { ...row, car };
}

/** The stored PDF itself: a resend sends the very document issued, never a new one (rule 12). */
function readStoredPdf(
  storage: FileDependencies["storage"],
  objectKey: string,
): Promise<Uint8Array | null> {
  return readStoredFile(storage, DOCUMENT_AREA, objectKey, "a document to email again");
}

export type EmailAgainResult =
  { status: "sent"; state: DocumentEmailState } | { status: "not_found" };

/**
 * "Email again": the copies that didn't go are sent once more, from the
 * stored PDF, and the try is recorded and logged (review G7-1, G9-9).
 */
export async function emailDocumentAgain(
  deps: FileDependencies & { emailSender: EmailSender },
  actor: ActingUser,
  documentId: string,
  timeZone: string,
): Promise<EmailAgainResult> {
  const document = await loadResendable(deps.database, actor.operatorId, documentId);
  if (!document || !isCopiedKind(document.kind)) {
    return { status: "not_found" };
  }
  const before = (await loadDocumentEmailStates(deps.database, actor.operatorId, [documentId])).get(
    documentId,
  );
  // Only the copies that haven't gone are sent again; both, if neither has.
  const unsent = DOCUMENT_EMAIL_RECIPIENTS.filter((recipient) => before?.[recipient] !== "sent");
  if (before && unsent.length === 0) {
    // Both went already (a second press, or an old page): nothing is sent twice.
    return { status: "sent", state: before };
  }
  const onlyTo = unsent.length === 1 ? unsent[0] : undefined;
  const pdf = await readStoredPdf(deps.storage, document.objectKey);
  if (!pdf) {
    return { status: "not_found" };
  }
  const carText = rentalSummaryText({
    carRego: document.car?.rego ?? null,
    carMakeModel: document.car ? `${document.car.make} ${document.car.model}` : null,
    rentalStart: null,
  });
  const state = await emailDocumentCopies(deps, {
    documentId,
    kind: document.kind,
    operatorId: actor.operatorId,
    renterEmail: document.renterEmail,
    renterName: document.greetingName,
    ...(document.renterKind === "organisation" &&
    document.driverName &&
    isChecklistCopy(document.kind)
      ? {
          forBusiness: { driverName: document.driverName, businessName: document.renterName },
        }
      : {}),
    rentalSummary: carText,
    atText: formatDateTimeInTimeZone(document.issuedAt, timeZone),
    fileName: `${[COPY_TITLES[document.kind], document.car?.rego].filter(Boolean).join(" ")}.pdf`,
    pdf,
    sentByUserId: actor.userId,
    onlyTo,
  });
  await withTenant(deps.database, actor.operatorId, (tx) =>
    recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.issuedDocument,
      entityId: documentId,
      action: ACTIVITY_ACTIONS.sent,
    }),
  );
  return { status: "sent", state };
}

/** A handover or return report, and the checklist it was made from. */
export interface ChecklistReport {
  documentId: string;
  kind: "handover_report" | "return_report";
  inspectionId: string;
  /** One of a swap's pair, not the rental's own first handover or final return. */
  isForSwap: boolean;
}

/**
 * Every report on a rental, each by its own checklist, so each button opens
 * its own report rather than the latest of its kind (review G9-5, G4-2).
 */
export async function listChecklistReports(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
): Promise<ChecklistReport[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        documentId: issuedDocuments.id,
        kind: issuedDocuments.kind,
        inspectionId: inspections.id,
        isForSwap: inspections.isForSwap,
      })
      .from(issuedDocuments)
      .innerJoin(
        inspections,
        and(
          eq(inspections.id, issuedDocuments.inspectionId),
          eq(inspections.operatorId, issuedDocuments.operatorId),
        ),
      )
      .where(
        and(eq(issuedDocuments.operatorId, operatorId), eq(issuedDocuments.rentalId, rentalId)),
      ),
  );
  return rows.flatMap((row) =>
    row.kind === "handover_report" || row.kind === "return_report"
      ? [{ ...row, kind: row.kind }]
      : [],
  );
}
