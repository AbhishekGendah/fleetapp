import { billingDocumentTitle, statementFigures } from "@fleetapp/core";
import { withTenant } from "@fleetapp/db/tenant-context";
import { z } from "zod";

import { issueDocument } from "../contracts/issued-documents";
import { selectRentalLedger } from "../ledger/ledger-queries";
import { requiredDate } from "../vehicles/amount-input";
import { loadBillingContext, type BillingDependencies } from "./billing-context";
import { loadBillingRental } from "./billing-documents";
import { renderStatementPdf } from "./billing-pdf";
import { loadBillingDocumentPdf } from "./billing-queries";
import { amountLineOf, emailBillingDocument } from "./billing-run";

export const STATEMENT_TITLE = "Statement";
const STATEMENT_AMOUNT_LINE = "It shows every charge, payment and credit, and the balance.";

/** The days a statement covers, both included. */
export const statementRangeSchema = z
  .object({ fromDate: requiredDate, toDate: requiredDate })
  .refine((range) => range.fromDate <= range.toDate, {
    message: "The last day must be on or after the first.",
    path: ["toDate"],
  });
export type StatementRange = z.infer<typeof statementRangeSchema>;
export const STATEMENT_FIELDS = ["fromDate", "toDate"] as const;

export type StatementResult =
  | { status: "issued"; issuedDocumentId: string; pdf: Uint8Array }
  | { status: "not_found" | "too_big" };

/**
 * A statement for the rental over a range of days (rule 12: issued and
 * kept as it was): the balance before, each line with the balance after
 * it, and the balance at the end, all added up from the ledger (rule 11).
 */
export async function issueStatement(
  deps: BillingDependencies,
  actor: { operatorId: string; userId: string },
  rentalId: string,
  range: StatementRange,
): Promise<StatementResult> {
  const context = await loadBillingContext(deps, actor.operatorId);
  const loaded = await withTenant(deps.database, actor.operatorId, async (tx) => {
    const rental = await loadBillingRental(tx, actor.operatorId, rentalId, false);
    return rental
      ? { rental, lines: await selectRentalLedger(tx, actor.operatorId, rentalId) }
      : null;
  });
  if (!loaded) {
    return { status: "not_found" };
  }
  const figures = statementFigures(loaded.lines, range.fromDate, range.toDate);
  const pdf = await renderStatementPdf({
    parties: {
      business: context.business,
      branding: context.branding,
      renterName: loaded.rental.renterName,
      rentalSummary: loaded.rental.rentalSummary,
    },
    header: { title: STATEMENT_TITLE, numberText: null, issuedOn: context.today },
    ...range,
    openingCents: figures.openingCents,
    rows: figures.lines.map((row, index) => ({
      ...row,
      signedCents:
        row.balanceAfterCents -
        (index === 0 ? figures.openingCents : (figures.lines[index - 1]?.balanceAfterCents ?? 0)),
    })),
    closingCents: figures.closingCents,
  });
  const issued = await issueDocument(deps, actor, {
    rentalId,
    kind: "statement",
    templateVersionId: null,
    pdf,
  });
  return issued.status === "issued"
    ? { status: "issued", issuedDocumentId: issued.documentId, pdf }
    : issued;
}

export type EmailAgainResult = "sent" | "no_email" | "not_found" | "failed";

/** Emails one of the rental's invoices, credit notes, receipts or statements to the Renter again. */
export async function emailBillingDocumentAgain(
  deps: BillingDependencies,
  operatorId: string,
  target: { rentalId: string; issuedDocumentId: string },
): Promise<EmailAgainResult> {
  const [document, context, rental] = await Promise.all([
    loadBillingDocumentPdf(deps, operatorId, target),
    loadBillingContext(deps, operatorId),
    withTenant(deps.database, operatorId, (tx) =>
      loadBillingRental(tx, operatorId, target.rentalId, false),
    ),
  ]);
  if (!document || !rental) {
    return "not_found";
  }
  if (!rental.renterEmail) {
    return "no_email";
  }
  const { kind } = document;
  const wording =
    kind === "statement"
      ? { title: STATEMENT_TITLE, amountLine: STATEMENT_AMOUNT_LINE }
      : {
          title: billingDocumentTitle(kind, document.isTaxDocument),
          amountLine: amountLineOf({
            kind,
            totalCents: document.totalCents ?? 0,
            gstCents: document.gstCents ?? 0,
            // A receipt's balance is printed on it, as it was when issued.
            balanceAfterCents: null,
          }),
        };
  const isSent = await emailBillingDocument(deps, context, rental, {
    ...wording,
    numberText: document.numberText,
    pdf: document.pdf,
  });
  return isSent ? "sent" : "failed";
}
