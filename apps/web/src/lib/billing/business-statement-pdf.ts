import {
  formatCalendarDate,
  formatCents,
  type BusinessStatementFigures,
  type CarStatement,
  type TemplateBlock,
} from "@fleetapp/core";

import { renderDocumentPdf, type DocumentPdfInput, type PdfTable } from "../contracts/document-pdf";
import { heading, line, paragraph } from "../handover/handover-report";
import { balanceText } from "../ledger/balance-text";
import type { LedgerLineView } from "../ledger/ledger-queries";
import { billedToBlocks } from "./billed-to";
import { businessBlocks, howToPayDocument, type BillingPdfParties } from "./billing-pdf";

/** Column widths, as shares of the page: date, what, invoice, charged, paid. */
const WIDTHS = { date: 13, what: 43, invoice: 14, charged: 15, paid: 15 } as const;
export const BUSINESS_STATEMENT_TITLE = "Statement";
const NOT_A_TAX_INVOICE = "This is a statement, not a tax invoice.";

/** One car's heading on the statement: its car, who drove it, and its terms. */
export interface StatementCar {
  rentalId: string;
  /** e.g. "1BRT482 · Toyota Camry Hybrid". */
  carText: string;
  /** The drivers who had it in these days, in turn; none while one is still to be named. */
  driverNames: readonly string[];
}

export interface BusinessStatementPdf {
  parties: Omit<BillingPdfParties, "rentalSummary" | "driverNames">;
  issuedOn: string;
  fromDate: string;
  toDate: string;
  figures: BusinessStatementFigures<LedgerLineView>;
  cars: ReadonlyMap<string, StatementCar>;
  /** The bond held on each of its rentals, kept apart from what is owed. */
  bonds: { heldCents: number; rentalCount: number };
  howToPay: string;
}

function driversText(car: StatementCar | undefined): string {
  if (!car || car.driverNames.length === 0) {
    return "driver to be named";
  }
  return car.driverNames.length === 1
    ? `driver ${car.driverNames[0]}`
    : `drivers ${car.driverNames.join(", then ")}`;
}

/** What a line is, as the statement names it: its kind and description. */
function whatText(item: LedgerLineView): string {
  return item.chargeTypeLabel ? `${item.chargeTypeLabel}: ${item.description}` : item.description;
}

const shownCents = (cents: number) => (cents === 0 ? "" : formatCents(cents));

/** One car's lines, a brought-forward line first when it had a balance before the days. */
function carTable(
  part: CarStatement<LedgerLineView>,
  car: StatementCar | undefined,
  fromDate: string,
): PdfTable {
  // Shown, not added in: the subtotals are the days' own, and Owing includes it.
  const broughtForward =
    part.openingCents === 0
      ? []
      : [
          [
            formatCalendarDate(fromDate),
            `Brought forward: ${balanceText(part.openingCents).toLowerCase()}`,
            "",
            "",
            "",
          ],
        ];
  const rego = car?.carText.split(" · ")[0] ?? "";
  return {
    heading: `${car?.carText ?? ""} · ${driversText(car)}`,
    columns: [
      { label: "Date", widthPercent: WIDTHS.date },
      { label: "What", widthPercent: WIDTHS.what },
      { label: "Invoice", widthPercent: WIDTHS.invoice },
      { label: "Charged", widthPercent: WIDTHS.charged, isAmount: true },
      { label: "Paid", widthPercent: WIDTHS.paid, isAmount: true },
    ],
    rows: [
      ...broughtForward,
      ...part.entries.map((entry) => [
        formatCalendarDate(entry.line.effectiveOn),
        whatText(entry.line),
        entry.line.documentNumberText ?? "",
        shownCents(entry.chargedCents),
        shownCents(entry.paidCents),
      ]),
    ],
    totals: [
      [`Charged on ${rego}`, formatCents(part.chargedCents)],
      [`Paid on ${rego}`, formatCents(part.paidCents)],
      [`Balance on ${rego}`, balanceText(part.closingCents)],
    ],
  };
}

function headerBlocks(input: BusinessStatementPdf): TemplateBlock[] {
  return [
    heading(1, BUSINESS_STATEMENT_TITLE),
    ...businessBlocks(input.parties.business),
    heading(2, "To"),
    ...billedToBlocks(input.parties.billedTo),
    line("Made", formatCalendarDate(input.issuedOn)),
    line("Days", `${formatCalendarDate(input.fromDate)} to ${formatCalendarDate(input.toDate)}`),
    line("All amounts", "AUD, GST included"),
    paragraph(NOT_A_TAX_INVOICE),
    heading(2, "Across all cars"),
    ...(input.figures.openingCents === 0
      ? []
      : [line("Brought forward", balanceText(input.figures.openingCents))]),
    line("Charged", formatCents(input.figures.chargedCents)),
    line("Paid", formatCents(input.figures.paidCents)),
    line("Balance", balanceText(input.figures.closingCents)),
    paragraph(
      input.figures.cars.length === 0
        ? "Nothing was charged or paid on its rentals in these days."
        : "Every charge and payment on its rentals in these days, grouped by car. Each car is invoiced and debited on its own; the invoice numbers are listed against each charge.",
    ),
  ];
}

function closingBlocks(input: BusinessStatementPdf): TemplateBlock[] {
  const howToPay = howToPayDocument(input.howToPay)?.content ?? [];
  const bonds =
    input.bonds.rentalCount === 0
      ? []
      : [
          paragraph(
            `Bonds are held separately and are not included: ${formatCents(input.bonds.heldCents)} held across ${input.bonds.rentalCount === 1 ? "1 rental" : `${input.bonds.rentalCount} rentals`}.`,
          ),
        ];
  return [...howToPay, paragraph(NOT_A_TAX_INVOICE), ...bonds];
}

/**
 * What a business Renter's statement across its cars prints (mockup 8,
 * approved 7 Nov 2026): who it is to, the totals across all cars, then each
 * car with its driver, its lines and its subtotal. Not a tax invoice: each
 * charge's own invoice is named against it. Drivers by name only. Pure.
 */
export function businessStatementPdfInput(input: BusinessStatementPdf): DocumentPdfInput {
  return {
    ...input.parties.branding,
    title: BUSINESS_STATEMENT_TITLE,
    document: { type: "doc", content: headerBlocks(input) },
    tables: input.figures.cars.map((part) =>
      carTable(part, input.cars.get(part.rentalId), input.fromDate),
    ),
    closing: { type: "doc", content: closingBlocks(input) },
  };
}

/** The statement as its fixed PDF. */
export function renderBusinessStatementPdf(input: BusinessStatementPdf): Promise<Uint8Array> {
  return renderDocumentPdf(businessStatementPdfInput(input));
}
