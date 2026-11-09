import {
  formatAbn,
  formatCalendarDate,
  formatCents,
  gstMarking,
  PAYMENT_METHOD_LABELS,
  type TemplateBlock,
  type TemplateDocument,
} from "@fleetapp/core";

import { renderDocumentPdf, type DocumentPdfInput, type PdfTable } from "../contracts/document-pdf";
import { heading, line, paragraph } from "../handover/handover-report";
import { balanceText } from "../ledger/balance-text";
import type { LedgerLineView } from "../ledger/ledger-queries";
import type { BusinessDetails } from "../settings/business-details";
import { billedToBlocks, type BilledTo } from "./billed-to";

/** Column widths, as shares of the page: date, what for, GST, amount. */
const WIDTHS = { date: 18, description: 47, gst: 18, amount: 17 } as const;
const HOW_TO_PAY_HEADING = "How to pay";

/** Who and what the document is about: the same on every kind. */
export interface BillingPdfParties {
  business: BusinessDetails;
  branding: Pick<DocumentPdfInput, "businessName" | "logo">;
  billedTo: BilledTo;
  /** e.g. "1ABC234 Toyota Corolla". */
  rentalSummary: string;
  /** A business's drivers by id, to name who had the car on each line. */
  driverNames: ReadonlyMap<string, string>;
}

export interface BillingPdfHeader {
  /** "Tax invoice", "Credit note", "Receipt", "Statement". */
  title: string;
  /** "INV-1001"; none for a statement. */
  numberText: string | null;
  issuedOn: string;
  /** e.g. "Corrects invoice INV-1001". */
  note?: string | undefined;
}

/** The business as the ATO asks a tax invoice to show it: its name, ABN and address. */
export function businessBlocks(business: BusinessDetails): TemplateBlock[] {
  const name = business.tradingName
    ? `${business.tradingName} (${business.legalName})`
    : business.legalName;
  const address = [
    business.addressLine1,
    business.addressLine2,
    [business.suburb, business.state, business.postcode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  return [
    paragraph(name ?? ""),
    ...(business.abn ? [line("ABN", formatAbn(business.abn))] : []),
    ...(address ? [paragraph(address)] : []),
    ...[business.phone, business.email].filter(Boolean).map((detail) => paragraph(detail ?? "")),
  ];
}

function headerDocument(parties: BillingPdfParties, header: BillingPdfHeader): TemplateDocument {
  return {
    type: "doc",
    content: [
      heading(1, header.numberText ? `${header.title} ${header.numberText}` : header.title),
      ...businessBlocks(parties.business),
      heading(2, "To"),
      ...billedToBlocks(parties.billedTo),
      line("Date", formatCalendarDate(header.issuedOn)),
      line("Rental", parties.rentalSummary),
      ...(header.note ? [paragraph(header.note)] : []),
    ],
  };
}

export function howToPayDocument(howToPay: string): TemplateDocument | undefined {
  if (howToPay.trim().length === 0) {
    return undefined;
  }
  return {
    type: "doc",
    content: [
      heading(2, HOW_TO_PAY_HEADING),
      ...howToPay.split("\n").map((text) => paragraph(text)),
    ],
  };
}

/**
 * A business's line names its car and who drove it then
 * (docs/plans/business-renters.md, decision 7): "1BRT482, driver Sam Lee".
 */
export function carAndDriverText(
  item: Pick<LedgerLineView, "rego" | "driverId">,
  driverNames: ReadonlyMap<string, string>,
): string {
  const driverName = item.driverId ? driverNames.get(item.driverId) : undefined;
  return driverName ? `${item.rego}, driver ${driverName}` : item.rego;
}

/**
 * What a line says on a document. A reversal names what it takes back, and
 * the document that was on, so the Renter can see what is corrected. Once a
 * rental has had more than one car (a swap), each line names its car
 * (review G4-3, batch 7 decision 7); a business's lines always name the car
 * and its driver.
 */
function lineText(
  item: LedgerLineView,
  allLines: readonly LedgerLineView[],
  parties: BillingPdfParties,
): string {
  const text = item.chargeTypeLabel
    ? `${item.chargeTypeLabel}: ${item.description}`
    : item.description;
  const reversed = item.reversesId
    ? allLines.find((line) => line.id === item.reversesId)
    : undefined;
  const isSwapped = new Set(allLines.map((line) => line.rego)).size > 1;
  const car =
    parties.billedTo.kind === "organisation"
      ? ` (${carAndDriverText(reversed ?? item, parties.driverNames)})`
      : isSwapped
        ? ` (${(reversed ?? item).rego})`
        : "";
  if (!reversed) {
    return `${text}${car}`;
  }
  const onDocument = reversed.documentNumberText ? ` on ${reversed.documentNumberText}` : "";
  return `${text}${car} (takes back "${reversed.description}"${onDocument})`;
}

/**
 * An invoice's or credit note's lines. A tax document shows how far each
 * line is taxable and the GST in it, and the GST total; otherwise no GST is
 * shown at all.
 */
function itemTable(input: ItemDocumentPdf): PdfTable {
  const { lines, isTaxDocument } = input;
  const totalCents = lines.reduce((total, item) => total + item.amountCents, 0);
  const gstCents = lines.reduce((total, item) => total + item.gstCents, 0);
  // A credit note takes amounts off: shown as minus figures (review G8-1).
  const shown = (cents: number) =>
    input.isReduction ? `-${formatCents(cents)}` : formatCents(cents);
  const gstColumn = isTaxDocument ? [{ label: "GST", widthPercent: WIDTHS.gst }] : [];
  return {
    columns: [
      { label: "Date", widthPercent: WIDTHS.date },
      {
        label: "Description",
        widthPercent: WIDTHS.description + (isTaxDocument ? 0 : WIDTHS.gst),
      },
      ...gstColumn,
      { label: "Amount", widthPercent: WIDTHS.amount, isAmount: true },
    ],
    rows: lines.map((item) => [
      formatCalendarDate(item.effectiveOn),
      lineText(item, input.allLines, input.parties),
      ...(isTaxDocument
        ? [item.gstCents > 0 ? shown(item.gstCents) : gstMarking(0, item.gstTreatment ?? "no_gst")]
        : []),
      shown(item.amountCents),
    ]),
    totals: [
      ...(isTaxDocument ? ([["GST included", shown(gstCents)]] as const) : []),
      ["Total", shown(totalCents)],
    ],
  };
}

export interface ItemDocumentPdf {
  parties: BillingPdfParties;
  header: BillingPdfHeader;
  lines: readonly LedgerLineView[];
  /** Every line of the rental, so a reversal can name what it takes back. */
  allLines: readonly LedgerLineView[];
  isTaxDocument: boolean;
  /** A credit note: its amounts take money off what is owed. */
  isReduction: boolean;
  /** Printed under an invoice; none on a credit note. */
  howToPay: string;
}

/** What an invoice or credit note prints: its header, lines and how to pay. Pure. */
export function itemDocumentPdfInput(input: ItemDocumentPdf): DocumentPdfInput {
  return {
    ...input.parties.branding,
    title: `${input.header.title} ${input.header.numberText ?? ""}`.trim(),
    document: headerDocument(input.parties, input.header),
    table: itemTable(input),
    closing: howToPayDocument(input.howToPay),
  };
}

/** An invoice or credit note, as its fixed PDF. */
export function renderItemDocumentPdf(input: ItemDocumentPdf): Promise<Uint8Array> {
  return renderDocumentPdf(itemDocumentPdfInput(input));
}

export interface ReceiptPdf {
  parties: BillingPdfParties;
  header: BillingPdfHeader;
  payment: LedgerLineView;
  /** What the Renter owes once this payment is counted; negative in credit. */
  balanceAfterCents: number;
}

/** A payment received, as its fixed PDF: how it was paid, and the balance after it. */
export function renderReceiptPdf(input: ReceiptPdf): Promise<Uint8Array> {
  const { payment } = input;
  const how = payment.method ? PAYMENT_METHOD_LABELS[payment.method] : "";
  return renderDocumentPdf({
    ...input.parties.branding,
    title: `${input.header.title} ${input.header.numberText ?? ""}`.trim(),
    document: headerDocument(input.parties, input.header),
    table: {
      columns: [
        { label: "Date", widthPercent: WIDTHS.date },
        { label: "Received by", widthPercent: WIDTHS.description + WIDTHS.gst },
        { label: "Amount", widthPercent: WIDTHS.amount, isAmount: true },
      ],
      rows: [
        [
          formatCalendarDate(payment.effectiveOn),
          payment.reference ? `${how}, reference ${payment.reference}` : how,
          formatCents(payment.amountCents),
        ],
      ],
      totals: [
        ["Balance after it", balanceText(input.balanceAfterCents)],
        ["Received", formatCents(payment.amountCents)],
      ],
    },
  });
}

export interface StatementPdf {
  parties: BillingPdfParties;
  header: BillingPdfHeader;
  fromDate: string;
  toDate: string;
  openingCents: number;
  rows: readonly { line: LedgerLineView; signedCents: number; balanceAfterCents: number }[];
  closingCents: number;
}

/** A statement for a range of days, as its PDF: the opening balance, each line, the closing balance. */
export function renderStatementPdf(input: StatementPdf): Promise<Uint8Array> {
  const document = headerDocument(input.parties, input.header);
  return renderDocumentPdf({
    ...input.parties.branding,
    title: input.header.title,
    document: {
      ...document,
      content: [
        ...document.content,
        line(
          "Days",
          `${formatCalendarDate(input.fromDate)} to ${formatCalendarDate(input.toDate)}`,
        ),
        line("Opening balance", balanceText(input.openingCents)),
      ],
    },
    table: {
      columns: [
        { label: "Date", widthPercent: WIDTHS.date },
        { label: "Description", widthPercent: WIDTHS.description },
        { label: "Amount", widthPercent: WIDTHS.gst, isAmount: true },
        { label: "Balance", widthPercent: WIDTHS.amount, isAmount: true },
      ],
      rows: input.rows.map(({ line: item, signedCents, balanceAfterCents }) => [
        formatCalendarDate(item.effectiveOn),
        [
          item.documentNumberText,
          item.description,
          input.parties.billedTo.kind === "organisation"
            ? carAndDriverText(item, input.parties.driverNames)
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        formatCents(signedCents),
        formatCents(balanceAfterCents),
      ]),
      totals: [["Closing balance", balanceText(input.closingCents)]],
    },
  });
}
