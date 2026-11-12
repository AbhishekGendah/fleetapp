import { billingDocumentTitle, statementFigures, type DocumentEmailOutcome } from "@fleetapp/core";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";

import { recordUserChange, type ActingUser } from "../acting-user";
import { issueDocument } from "../contracts/issued-documents";
import { selectRentalLedger } from "../ledger/ledger-queries";
import { loadBillingContext, type BillingDependencies } from "./billing-context";
import { loadBillingRental, loadLineDriverNames } from "./billing-documents";
import { renderStatementPdf } from "./billing-pdf";
import { loadBillingDocumentPdf } from "./billing-queries";
import { amountLineOf, emailBillingDocument } from "./billing-email";
import { emailBillingDocumentRecorded } from "./charge-notices";
import type { StatementRange } from "./statement-input";

export const STATEMENT_TITLE = "Statement";
const STATEMENT_AMOUNT_LINE = "It shows every charge, payment and credit, and the balance.";

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
    if (!rental) {
      return null;
    }
    const lines = await selectRentalLedger(tx, actor.operatorId, rentalId);
    const driverNames = await loadLineDriverNames(tx, actor.operatorId, rental.billedTo, lines);
    return { rental, lines, driverNames };
  });
  if (!loaded) {
    return { status: "not_found" };
  }
  const figures = statementFigures(loaded.lines, range.fromDate, range.toDate);
  const pdf = await renderStatementPdf({
    parties: {
      business: context.business,
      branding: context.branding,
      billedTo: loaded.rental.billedTo,
      rentalSummary: loaded.rental.rentalSummary,
      driverNames: loaded.driverNames,
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

const EMAIL_AGAIN_RESULTS: Readonly<Record<DocumentEmailOutcome, EmailAgainResult>> = {
  sent: "sent",
  no_address: "no_email",
  failed: "failed",
};

/**
 * Emails one of the rental's invoices, credit notes, receipts or statements
 * to the Renter again, as the User asked: an invoice, credit note or receipt
 * is recorded against it (and an invoice's one-off charges get their notice
 * date once it is sent), and logged (rule 19).
 */
export async function emailBillingDocumentAgain(
  deps: BillingDependencies,
  actor: ActingUser,
  target: { rentalId: string; issuedDocumentId: string },
): Promise<EmailAgainResult> {
  const { operatorId } = actor;
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
  if (kind === "statement") {
    const isSent = await emailBillingDocument(deps, context, rental, {
      title: STATEMENT_TITLE,
      amountLine: STATEMENT_AMOUNT_LINE,
      numberText: document.numberText,
      pdf: document.pdf,
    });
    return isSent ? "sent" : "failed";
  }
  const outcome = await emailBillingDocumentRecorded(
    deps,
    operatorId,
    context,
    rental,
    {
      issuedDocumentId: document.issuedDocumentId,
      title: billingDocumentTitle(kind, document.isTaxDocument),
      numberText: document.numberText,
      amountLine: amountLineOf({
        kind,
        totalCents: document.totalCents ?? 0,
        gstCents: document.gstCents ?? 0,
        // A receipt's balance is printed on it, as it was when issued.
        balanceAfterCents: null,
      }),
      pdf: document.pdf,
    },
    { userId: actor.userId },
  );
  // Who sent it and when, never to which address (rule 7); only when it went.
  if (outcome === "sent") {
    await withTenant(deps.database, operatorId, (tx) =>
      recordUserChange(tx, actor, {
        entityType: ACTIVITY_ENTITY_TYPES.issuedDocument,
        entityId: document.issuedDocumentId,
        action: ACTIVITY_ACTIONS.sent,
      }),
    );
  }
  return EMAIL_AGAIN_RESULTS[outcome];
}
