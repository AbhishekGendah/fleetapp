import {
  BOND_MOVEMENT_KIND_LABELS,
  CLAIM_STATUS_LABELS,
  DAMAGE_STATUS_LABELS,
  describeDevice,
  formatCalendarDate,
  formatCents,
  formatDateTimeInTimeZone,
  ISSUED_DOCUMENT_NAMES,
  LEDGER_LINE_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  RENTAL_CHANGE_KIND_LABELS,
  RENTAL_CHANGE_STATUS_LABELS,
  RENTAL_STATUS_LABELS,
  RENTAL_TYPE_LABELS,
  RENTER_LINK_PURPOSE_LABELS,
  SIGNING_EVIDENCE_STEP_LABELS,
  type ExportCell,
  type MandateEndReason,
  type MandateStatus,
} from "@fleetapp/core";
import type { WorkbookSheet } from "@fleetapp/core/spreadsheet";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  billingDocuments,
  bondMovements,
  damageRecords,
  documentEmails,
  files,
  insuranceClaims,
  issuedDocuments,
  ledgerLines,
  paymentMandates,
  payments,
  rentalChanges,
  rentals,
  renterLinks,
  renters,
  signingEvidence,
  vehicles,
} from "@fleetapp/db/schema";
import { aliasedTable, and, asc, eq, inArray, or, sql, type Column } from "drizzle-orm";

const driver = aliasedTable(renters, "driver");

/** A document as the download holds it: what it is, and where its PDF is kept. */
export const HELD_DOCUMENT_COLUMNS = {
  id: issuedDocuments.id,
  rentalId: issuedDocuments.rentalId,
  kind: issuedDocuments.kind,
  version: issuedDocuments.version,
  issuedAt: issuedDocuments.issuedAt,
  storageArea: files.storageArea,
  objectKey: files.objectKey,
  contentType: files.contentType,
};

/** A business's statement across its cars, in the Rental column. */
const ACROSS_ITS_CARS = "All its cars";

/** How other people are shown: the Renter asked what is held about them, not who did it. */
export const THE_BUSINESS = "The business";

const MANDATE_STATUS_LABELS: Readonly<Record<MandateStatus, string>> = {
  waiting: "Waiting for the bank",
  active: "Active",
  inactive: "Stopped",
};
const MANDATE_END_REASON_LABELS: Readonly<Record<MandateEndReason, string>> = {
  cancelled: "Cancelled",
  replaced: "Replaced by a newer one",
};

/**
 * Everything held about a Renter's rentals and the business's dealings with
 * them, read in the business's own tenant context (rule 1). Each list is
 * scoped by the Renter, or by rentals that are theirs.
 */
async function selectHeldRecords(tx: AnyTransaction, operatorId: string, renterId: string) {
  const ownRentals = await tx
    .select({
      id: rentals.id,
      rego: vehicles.rego,
      // Who drove it: the Renter themselves, or a business's driver (by name only, never their licence).
      driverName: driver.fullName,
      type: rentals.type,
      status: rentals.status,
      plannedStart: rentals.plannedStart,
      plannedEnd: rentals.plannedEnd,
      handedOverAt: rentals.handedOverAt,
      returnedAt: rentals.returnedAt,
      bondCents: rentals.bondCents,
      cancelledAt: rentals.cancelledAt,
      cancellationReason: rentals.cancellationReason,
    })
    .from(rentals)
    .innerJoin(vehicles, eq(vehicles.id, rentals.vehicleId))
    .leftJoin(
      driver,
      and(eq(driver.id, rentals.driverId), eq(driver.operatorId, rentals.operatorId)),
    )
    .where(and(eq(rentals.operatorId, operatorId), eq(rentals.renterId, renterId)))
    .orderBy(asc(rentals.plannedStart));
  const rentalIds = ownRentals.map((rental) => rental.id);
  // No rentals: nothing of theirs to match, rather than an empty list Postgres refuses.
  const ofRentals = (column: Column) =>
    rentalIds.length > 0 ? inArray(column, rentalIds) : sql`false`;
  const links = await tx
    .select({
      id: renterLinks.id,
      purpose: renterLinks.purpose,
      sentToEmail: renterLinks.sentToEmail,
      sentAt: renterLinks.createdAt,
      expiresAt: renterLinks.expiresAt,
      usedAt: renterLinks.usedAt,
      cancelledAt: renterLinks.cancelledAt,
    })
    .from(renterLinks)
    .where(and(eq(renterLinks.operatorId, operatorId), eq(renterLinks.renterId, renterId)))
    .orderBy(asc(renterLinks.createdAt));
  const linkIds = links.map((link) => link.id);

  const [changes, lines, bond, billing, mandates, stripePayments, damage, documents] =
    await Promise.all([
      tx
        .select()
        .from(rentalChanges)
        .where(and(eq(rentalChanges.operatorId, operatorId), ofRentals(rentalChanges.rentalId)))
        .orderBy(asc(rentalChanges.createdAt)),
      tx
        .select()
        .from(ledgerLines)
        .where(and(eq(ledgerLines.operatorId, operatorId), ofRentals(ledgerLines.rentalId)))
        .orderBy(asc(ledgerLines.effectiveOn), asc(ledgerLines.createdAt)),
      tx
        .select()
        .from(bondMovements)
        .where(and(eq(bondMovements.operatorId, operatorId), ofRentals(bondMovements.rentalId)))
        .orderBy(asc(bondMovements.occurredOn), asc(bondMovements.createdAt)),
      tx
        .select()
        .from(billingDocuments)
        .where(
          and(eq(billingDocuments.operatorId, operatorId), ofRentals(billingDocuments.rentalId)),
        )
        .orderBy(asc(billingDocuments.issuedOn), asc(billingDocuments.number)),
      tx
        .select()
        .from(paymentMandates)
        .where(
          and(eq(paymentMandates.operatorId, operatorId), eq(paymentMandates.renterId, renterId)),
        )
        .orderBy(asc(paymentMandates.createdAt)),
      tx
        .select()
        .from(payments)
        .where(and(eq(payments.operatorId, operatorId), eq(payments.renterId, renterId)))
        .orderBy(asc(payments.createdAt)),
      tx
        .select({ record: damageRecords, claim: insuranceClaims })
        .from(damageRecords)
        .leftJoin(insuranceClaims, eq(insuranceClaims.damageRecordId, damageRecords.id))
        .where(and(eq(damageRecords.operatorId, operatorId), eq(damageRecords.renterId, renterId)))
        .orderBy(asc(damageRecords.foundOn)),
      tx
        .select(HELD_DOCUMENT_COLUMNS)
        .from(issuedDocuments)
        .innerJoin(files, eq(files.id, issuedDocuments.fileId))
        .where(
          and(
            eq(issuedDocuments.operatorId, operatorId),
            // A business's statements across its cars are its own, not one rental's.
            or(ofRentals(issuedDocuments.rentalId), eq(issuedDocuments.renterId, renterId)),
          ),
        )
        .orderBy(asc(issuedDocuments.issuedAt)),
    ]);
  const documentIds = documents.map((document) => document.id);
  const [evidence, emails] = await Promise.all([
    linkIds.length === 0
      ? []
      : tx
          .select()
          .from(signingEvidence)
          .where(
            and(
              eq(signingEvidence.operatorId, operatorId),
              inArray(signingEvidence.linkId, linkIds),
            ),
          )
          .orderBy(asc(signingEvidence.occurredAt)),
    documentIds.length === 0
      ? []
      : tx
          .select()
          .from(documentEmails)
          .where(
            and(
              eq(documentEmails.operatorId, operatorId),
              inArray(documentEmails.documentId, documentIds),
              eq(documentEmails.recipient, "renter"),
            ),
          )
          .orderBy(asc(documentEmails.triedAt)),
  ]);
  return {
    rentals: ownRentals,
    links,
    changes,
    lines,
    bond,
    billing,
    mandates,
    payments: stripePayments,
    damage,
    documents,
    evidence,
    emails,
  };
}

export type HeldRecords = Awaited<ReturnType<typeof selectHeldRecords>>;

export function loadHeldRecords(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<HeldRecords> {
  return selectHeldRecords(tx, operatorId, renterId);
}
export type HeldDocument = HeldRecords["documents"][number];

/** The words each sheet's cells are made with. */
interface Wording {
  when: (moment: Date | null) => ExportCell;
  day: (date: string | null) => ExportCell;
  rentalOf: (rentalId: string | null) => ExportCell;
}

function wordingFor(records: HeldRecords, timeZone: string): Wording {
  const rentalNames = new Map(
    records.rentals.map((rental) => [
      rental.id,
      `${rental.rego}, from ${formatDateTimeInTimeZone(rental.plannedStart, timeZone)}`,
    ]),
  );
  return {
    when: (moment) => (moment ? formatDateTimeInTimeZone(moment, timeZone) : null),
    day: (date) => (date ? formatCalendarDate(date) : null),
    rentalOf: (rentalId) => (rentalId ? (rentalNames.get(rentalId) ?? null) : null),
  };
}

const money = (cents: number | null): ExportCell => (cents === null ? null : formatCents(cents));

function rentalsSheet(records: HeldRecords, words: Wording): WorkbookSheet {
  return {
    name: "Rentals",
    table: [
      [
        "Car",
        "Driver",
        "Type",
        "Status",
        "Starts",
        "Ends",
        "Handed over",
        "Returned",
        "Bond",
        "Cancelled",
        "Why cancelled",
      ],
      ...records.rentals.map((rental) => [
        rental.rego,
        rental.driverName ?? "To be named",
        RENTAL_TYPE_LABELS[rental.type],
        RENTAL_STATUS_LABELS[rental.status],
        words.when(rental.plannedStart),
        words.when(rental.plannedEnd),
        words.when(rental.handedOverAt),
        words.when(rental.returnedAt),
        money(rental.bondCents),
        words.when(rental.cancelledAt),
        rental.cancellationReason,
      ]),
    ],
  };
}

function changesSheet(records: HeldRecords, words: Wording): WorkbookSheet {
  return {
    name: "Changes of terms",
    table: [
      [
        "Rental",
        "Change",
        "Status",
        "Why",
        "End before",
        "End after",
        "Rate before",
        "Rate after",
        "Applies from",
        "Made",
        "Applied",
        "Withdrawn",
      ],
      ...records.changes.map((change) => [
        words.rentalOf(change.rentalId),
        RENTAL_CHANGE_KIND_LABELS[change.kind],
        RENTAL_CHANGE_STATUS_LABELS[change.status],
        change.reason,
        words.when(change.endBefore),
        words.when(change.endAfter),
        money(change.rateBeforeCents),
        money(change.rateAfterCents),
        words.day(change.appliesFrom),
        words.when(change.createdAt),
        words.when(change.appliedAt),
        words.when(change.withdrawnAt),
      ]),
    ],
  };
}

function moneySheet(records: HeldRecords, words: Wording): WorkbookSheet {
  return {
    name: "Charges and payments",
    table: [
      [
        "Rental",
        "Date",
        "Kind",
        "Description",
        "Amount",
        "GST",
        "Paid by",
        "Reference",
        "Correction",
      ],
      ...records.lines.map((line) => [
        words.rentalOf(line.rentalId),
        words.day(line.effectiveOn),
        LEDGER_LINE_KIND_LABELS[line.kind],
        line.description,
        money(line.amountCents),
        money(line.gstCents),
        line.method ? PAYMENT_METHOD_LABELS[line.method] : null,
        line.reference,
        line.isCorrection || line.reversesId ? "Yes" : null,
      ]),
    ],
  };
}

function bondSheet(records: HeldRecords, words: Wording): WorkbookSheet {
  return {
    name: "Bond",
    table: [
      ["Rental", "Date", "What", "Amount", "Paid by", "Reference", "Note"],
      ...records.bond.map((movement) => [
        words.rentalOf(movement.rentalId),
        words.day(movement.occurredOn),
        BOND_MOVEMENT_KIND_LABELS[movement.kind],
        money(movement.amountCents),
        movement.method ? PAYMENT_METHOD_LABELS[movement.method] : null,
        movement.reference,
        movement.note,
      ]),
    ],
  };
}

function billingSheet(records: HeldRecords, words: Wording): WorkbookSheet {
  return {
    name: "Invoices and receipts",
    table: [
      ["Rental", "Document", "Number", "Issued", "Total", "GST"],
      ...records.billing.map((document) => [
        words.rentalOf(document.rentalId),
        ISSUED_DOCUMENT_NAMES[document.kind],
        document.numberText,
        words.day(document.issuedOn),
        money(document.totalCents),
        money(document.gstCents),
      ]),
    ],
  };
}

/** Direct debits and payments through Stripe. Never a bank or card number: Stripe holds those. */
function directDebitSheet(records: HeldRecords, words: Wording): WorkbookSheet {
  return {
    name: "Direct debit and Stripe",
    table: [
      [
        "What",
        "Method",
        "Status",
        "Amount",
        "Rental",
        "Set up or started",
        "Ended",
        "Why it ended",
      ],
      ...records.mandates.map((mandate) => [
        "Direct debit agreement",
        PAYMENT_METHOD_LABELS[mandate.method],
        MANDATE_STATUS_LABELS[mandate.status],
        null,
        null,
        words.when(mandate.setUpAt ?? mandate.createdAt),
        words.when(mandate.endedAt),
        mandate.endReason ? MANDATE_END_REASON_LABELS[mandate.endReason] : null,
      ]),
      ...records.payments.map((payment) => [
        "Bond payment",
        PAYMENT_METHOD_LABELS[payment.method],
        PAYMENT_STATUS_LABELS[payment.status],
        money(payment.amountCents),
        words.rentalOf(payment.rentalId),
        words.when(payment.createdAt),
        words.when(payment.settledAt),
        payment.failureCode,
      ]),
    ],
  };
}

function typedNameOf(details: unknown): ExportCell {
  if (typeof details !== "object" || details === null || !("typedName" in details)) {
    return null;
  }
  return typeof details.typedName === "string" ? details.typedName : null;
}

function signingSheet(records: HeldRecords, words: Wording): WorkbookSheet {
  return {
    name: "Signing records",
    table: [
      ["Rental", "Step", "When", "Internet address", "Phone or browser", "Typed name"],
      ...records.evidence.map((step) => [
        words.rentalOf(step.rentalId),
        SIGNING_EVIDENCE_STEP_LABELS[step.step],
        words.when(step.occurredAt),
        step.ipAddress,
        describeDevice(step.userAgent),
        typedNameOf(step.details),
      ]),
    ],
  };
}

function linksSheet(records: HeldRecords, words: Wording): WorkbookSheet {
  return {
    name: "Links",
    table: [
      ["Link", "Sent to", "Sent", "Works until", "Used", "Cancelled"],
      ...records.links.map((link) => [
        RENTER_LINK_PURPOSE_LABELS[link.purpose],
        link.sentToEmail,
        words.when(link.sentAt),
        words.when(link.expiresAt),
        words.when(link.usedAt),
        words.when(link.cancelledAt),
      ]),
    ],
  };
}

function damageSheet(records: HeldRecords, words: Wording): WorkbookSheet {
  return {
    name: "Damage",
    table: [
      [
        "Rental",
        "Found",
        "Description",
        "Status",
        "Note",
        "Insurer",
        "Claim number",
        "Claim status",
        "Excess",
      ],
      ...records.damage.map(({ record, claim }) => [
        words.rentalOf(record.rentalId),
        words.day(record.foundOn),
        record.description,
        DAMAGE_STATUS_LABELS[record.status],
        record.statusNote,
        claim?.insurer ?? null,
        claim?.claimNumber ?? null,
        claim ? CLAIM_STATUS_LABELS[claim.status] : null,
        money(claim?.excessCents ?? null),
      ]),
    ],
  };
}

function emailsSheet(records: HeldRecords, words: Wording): WorkbookSheet {
  const documentsById = new Map(records.documents.map((document) => [document.id, document]));
  return {
    name: "Emails sent",
    table: [
      ["Document", "Rental", "Tried", "What happened"],
      ...records.emails.map((email) => {
        const document = documentsById.get(email.documentId);
        return [
          document ? ISSUED_DOCUMENT_NAMES[document.kind] : null,
          words.rentalOf(document?.rentalId ?? null),
          words.when(email.triedAt),
          email.outcome,
        ];
      }),
    ],
  };
}

function documentsSheet(records: HeldRecords, words: Wording): WorkbookSheet {
  return {
    name: "Documents",
    table: [
      ["Document", "Version", "Rental", "Issued", "File in this download"],
      ...records.documents.map((document) => [
        ISSUED_DOCUMENT_NAMES[document.kind],
        document.version,
        document.rentalId ? words.rentalOf(document.rentalId) : ACROSS_ITS_CARS,
        words.when(document.issuedAt),
        heldDocumentFileName(document),
      ]),
    ],
  };
}

/** Where each document sits in the download: its kind, version and a short id, never a name. */
export function heldDocumentFileName(document: HeldDocument): string {
  const kind = ISSUED_DOCUMENT_NAMES[document.kind].toLowerCase().replaceAll(" ", "-");
  return `documents/${kind}-v${document.version}-${document.id.slice(0, 8)}.pdf`;
}

/** The rental and money sheets of "everything we hold", in the order a person would read them. */
export function heldRecordSheets(records: HeldRecords, timeZone: string): WorkbookSheet[] {
  const words = wordingFor(records, timeZone);
  return [
    rentalsSheet(records, words),
    changesSheet(records, words),
    moneySheet(records, words),
    bondSheet(records, words),
    billingSheet(records, words),
    directDebitSheet(records, words),
    signingSheet(records, words),
    linksSheet(records, words),
    damageSheet(records, words),
    emailsSheet(records, words),
    documentsSheet(records, words),
  ];
}
