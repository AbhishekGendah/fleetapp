import { isGstRegisteredOn, type GstTreatment, type LedgerLineKind } from "./ledger";

/**
 * Invoices, credit notes and receipts (docs/plans/phase-4.md, slice 2):
 * fixed documents made from ledger lines (rule 12), each line on at most
 * one of them. Invoices and credit notes share one number sequence per
 * Operator with no gaps (rule 17); receipts have their own.
 */
export const BILLING_DOCUMENT_KINDS = ["invoice", "credit_note", "receipt"] as const;
export type BillingDocumentKind = (typeof BILLING_DOCUMENT_KINDS)[number];

export const NUMBERING_SERIES = ["invoice", "receipt"] as const;
export type NumberingSeries = (typeof NUMBERING_SERIES)[number];

export const SERIES_OF_KIND: Readonly<Record<BillingDocumentKind, NumberingSeries>> = {
  invoice: "invoice",
  credit_note: "invoice",
  receipt: "receipt",
};

export interface Numbering {
  prefix: string;
  /** The number the next document takes. */
  nextNumber: number;
}

/** Where a business's numbering starts until it chooses its own (rule 27). */
export const DEFAULT_NUMBERING: Readonly<Record<NumberingSeries, Numbering>> = {
  invoice: { prefix: "INV-", nextNumber: 1001 },
  receipt: { prefix: "RCT-", nextNumber: 1 },
};

export const NUMBERING_SERIES_LABELS: Readonly<Record<NumberingSeries, string>> = {
  invoice: "Invoices and credit notes",
  receipt: "Receipts",
};

export const NUMBER_PREFIX_MAX_LENGTH = 10;
/** Capitals, digits and a few separators: it prints on every invoice (rule 31). */
export const NUMBER_PREFIX_PATTERN = /^[A-Z0-9\-/.]*$/;
/** Eight digits: far more invoices than a business sends in its life. */
export const MAXIMUM_DOCUMENT_NUMBER = 99_999_999;

/** "INV-1001": the number as printed, kept with the document for good. */
export function documentNumberText(numbering: Numbering): string {
  return `${numbering.prefix}${numbering.nextNumber}`;
}

/**
 * What the document is called. A GST-registered business's invoice is a tax
 * invoice, and its credit note is an adjustment note (GST Act s29-75);
 * otherwise plain words, with no GST shown.
 */
export function billingDocumentTitle(kind: BillingDocumentKind, isTaxDocument: boolean): string {
  if (kind === "invoice") {
    return isTaxDocument ? "Tax invoice" : "Invoice";
  }
  if (kind === "credit_note") {
    return isTaxDocument ? "Adjustment note" : "Credit note";
  }
  return "Receipt";
}

/** A tax invoice or adjustment note when the business is GST-registered on the day it is issued. */
export function isTaxDocumentOn(registeredFrom: string | null, issuedOn: string): boolean {
  return isGstRegisteredOn(registeredFrom, issuedOn);
}

/** How a line is marked on a tax invoice: the ATO asks for the extent each item is taxable. */
export function gstMarking(gstCents: number, treatment: GstTreatment): string {
  if (gstCents > 0) {
    return "Includes GST";
  }
  return treatment === "gst_free" ? "GST-free" : "No GST";
}

export const HOW_TO_PAY_MAX_LENGTH = 500;

/** A ledger line as far as documents go: what it is, and the document it is on, if any. */
export interface BillableLine {
  id: string;
  kind: LedgerLineKind;
  reversesId: string | null;
  /**
   * Rent and its corrections carry the period they cover: its first day, or
   * for block rent the exact moment it starts.
   */
  periodStart: string | null;
  /** A correction to a block period already charged. */
  isCorrection?: boolean;
  /** The invoice, credit note or receipt it is on. */
  documentId: string | null;
}

export interface PendingCreditNote {
  /** The invoice it corrects, when it is known. */
  relatesToDocumentId: string | null;
  lineIds: string[];
}

export interface PendingDocuments {
  /** The next invoice's lines (issued one invoice at a time). */
  invoiceLineIds: string[];
  creditNotes: PendingCreditNote[];
  /** One receipt each. */
  receiptLineIds: string[];
}

/** Rent, or a correction to it: invoiced together, at once. */
function isRentLine(line: BillableLine): boolean {
  return line.kind === "charge" && line.periodStart !== null;
}

/**
 * A one-off charge (cleaning, damage, a fee): a charge for no rent period.
 * Each goes on an invoice of its own at once, emailed to the Renter before
 * it can ever be debited (docs/plans/one-off-charge-notice.md).
 */
export function isOneOffCharge(line: Pick<BillableLine, "kind" | "periodStart">): boolean {
  return line.kind === "charge" && line.periodStart === null;
}

/** A period's own rent charge, which its corrections and credits point back to. */
function isOriginalRentLine(line: BillableLine): boolean {
  return isRentLine(line) && line.isCorrection !== true;
}

/**
 * The next invoice's lines: waiting rent (with any credit taken back) on
 * one, before each waiting one-off charge on its own.
 */
function nextInvoiceLineIds(
  waitingCharges: readonly BillableLine[],
  creditReversalIds: readonly string[],
): string[] {
  const rentIds = [
    ...waitingCharges.filter(isRentLine).map((line) => line.id),
    ...creditReversalIds,
  ];
  if (rentIds.length > 0) {
    return rentIds;
  }
  const oneOff = waitingCharges.find(isOneOffCharge);
  return oneOff ? [oneOff.id] : [];
}

/** The invoice a credit corrects: the one with the charge it reverses, or the rent of its period. */
function correctedDocumentId(
  line: BillableLine,
  linesById: ReadonlyMap<string, BillableLine>,
  rentByPeriod: ReadonlyMap<string, BillableLine>,
): string | null {
  if (line.kind === "reversal") {
    return line.reversesId ? (linesById.get(line.reversesId)?.documentId ?? null) : null;
  }
  return line.periodStart ? (rentByPeriod.get(line.periodStart)?.documentId ?? null) : null;
}

/** Credits and reversals of invoiced charges, one credit note per invoice they correct. */
function creditNotesOf(lines: readonly BillableLine[], reversedIds: ReadonlySet<string>) {
  const linesById = new Map(lines.map((line) => [line.id, line]));
  const rentByPeriod = new Map(
    lines.filter(isOriginalRentLine).map((line) => [line.periodStart as string, line]),
  );
  const notes = new Map<string | null, string[]>();
  for (const line of lines) {
    if (line.documentId !== null || reversedIds.has(line.id)) {
      continue;
    }
    const reversed = line.reversesId ? linesById.get(line.reversesId) : undefined;
    const isCorrection =
      line.kind === "credit" ||
      (line.kind === "reversal" && reversed?.kind === "charge" && reversed.documentId !== null);
    if (!isCorrection) {
      continue;
    }
    const relatesTo = correctedDocumentId(line, linesById, rentByPeriod);
    notes.set(relatesTo, [...(notes.get(relatesTo) ?? []), line.id]);
  }
  return [...notes].map(([relatesToDocumentId, lineIds]) => ({ relatesToDocumentId, lineIds }));
}

/**
 * Taking back a credit that is already on a credit note raises what the
 * Renter owes, so it goes on an invoice at once (review A4-7). One reversed
 * before it was on a document needs none, like any other.
 */
function creditReversalIdsOf(
  lines: readonly BillableLine[],
  isWaiting: (line: BillableLine) => boolean,
): string[] {
  const linesById = new Map(lines.map((line) => [line.id, line]));
  return lines
    .filter((line) => {
      const reversed = line.reversesId ? linesById.get(line.reversesId) : undefined;
      return (
        line.kind === "reversal" &&
        isWaiting(line) &&
        reversed?.kind === "credit" &&
        reversed.documentId !== null
      );
    })
    .map((line) => line.id);
}

/**
 * The documents a rental's lines still need, the next invoice first (rent,
 * then each one-off charge on its own), then the credit notes that correct
 * invoices. A line reversed before it was on a document needs none, and
 * neither does its reversal; a reversed payment keeps its receipt (the
 * statement shows both).
 */
export function pendingDocuments(lines: readonly BillableLine[]): PendingDocuments {
  const reversedIds = new Set(lines.flatMap((line) => (line.reversesId ? [line.reversesId] : [])));
  const isWaiting = (line: BillableLine) => line.documentId === null && !reversedIds.has(line.id);
  return {
    invoiceLineIds: nextInvoiceLineIds(
      lines.filter((line) => line.kind === "charge" && isWaiting(line)),
      creditReversalIdsOf(lines, isWaiting),
    ),
    creditNotes: creditNotesOf(lines, reversedIds),
    receiptLineIds: lines
      .filter((line) => line.kind === "payment" && isWaiting(line))
      .map((line) => line.id),
  };
}

/** Whether anything at all is waiting for a document. */
export function hasPendingDocuments(pending: PendingDocuments): boolean {
  return (
    pending.invoiceLineIds.length > 0 ||
    pending.creditNotes.length > 0 ||
    pending.receiptLineIds.length > 0
  );
}

export interface DocumentLineAmount {
  amountCents: number;
  gstCents: number;
}

/** A document's total and its GST: the sum of its lines' stored amounts (rule 9). */
export function documentTotals(lines: readonly DocumentLineAmount[]): DocumentLineAmount {
  return lines.reduce(
    (total, line) => ({
      amountCents: total.amountCents + line.amountCents,
      gstCents: total.gstCents + line.gstCents,
    }),
    { amountCents: 0, gstCents: 0 },
  );
}
