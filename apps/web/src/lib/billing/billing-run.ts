import { describeErrorForLog, formatCents, MILLISECONDS_PER_DAY } from "@fleetapp/core";
import { billingDocumentLines, ledgerLines } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { renderBillingDocumentEmail } from "@fleetapp/email";
import { and, eq, gte, isNull, sql } from "drizzle-orm";

import type { IssuingActor } from "../contracts/issued-documents";
import { findDueOperators, forEachOperator, type OperatorRun } from "../jobs/due-operators";
import { balanceText } from "../ledger/balance-text";
import { greetingNameOf } from "./billed-to";
import {
  loadBillingContext,
  type BillingContext,
  type BillingDependencies,
} from "./billing-context";
import {
  issueNextDocument,
  loadBillingRental,
  type BillingRental,
  type IssuedBilling,
} from "./billing-documents";

/**
 * A rental never needs this many documents at once; the limit only stops a
 * fault from looping for ever.
 */
const MOST_DOCUMENTS_PER_RUN = 50;
/** Lines this old with no document are left to the Operator: the run has tried every night. */
const CATCH_UP_LOOKBACK_DAYS = 60;

/** The line the Renter most needs in the email. A receipt's balance is left out when not known. */
export function amountLineOf(issued: {
  kind: IssuedBilling["kind"];
  totalCents: number;
  gstCents: number;
  balanceAfterCents: number | null;
}): string {
  if (issued.kind === "receipt") {
    const balance =
      issued.balanceAfterCents === null
        ? ""
        : ` Balance: ${balanceText(issued.balanceAfterCents).toLowerCase()}.`;
    return `Received ${formatCents(issued.totalCents)}.${balance}`;
  }
  const gst = issued.gstCents > 0 ? `, including GST of ${formatCents(issued.gstCents)}` : "";
  return issued.kind === "credit_note"
    ? `Credit ${formatCents(issued.totalCents)}${gst}.`
    : `Total ${formatCents(issued.totalCents)}${gst}.`;
}

/** Emails a document to the Renter (a business's contact) from the business. It is kept either way, so a failure is logged, never raised. */
export async function emailBillingDocument(
  deps: BillingDependencies,
  context: Pick<BillingContext, "business" | "operatorName">,
  rental: Pick<BillingRental, "renterEmail" | "billedTo" | "rentalSummary">,
  document: { title: string; numberText: string | null; amountLine: string; pdf: Uint8Array },
): Promise<boolean> {
  if (!rental.renterEmail) {
    return false;
  }
  try {
    await deps.emailSender.send(
      await renderBillingDocumentEmail({
        to: rental.renterEmail,
        replyTo: context.business.email ?? undefined,
        title: document.title,
        numberText: document.numberText,
        renterName: greetingNameOf(rental.billedTo),
        businessName: rental.billedTo.kind === "organisation" ? rental.billedTo.name : undefined,
        operatorName: context.operatorName,
        rentalSummary: rental.rentalSummary,
        amountLine: document.amountLine,
        attachment: {
          fileName: `${document.numberText ?? document.title}.pdf`,
          contentType: "application/pdf",
          content: document.pdf,
        },
      }),
    );
    return true;
  } catch (error) {
    console.error(`Emailing a ${document.title.toLowerCase()} failed`, describeErrorForLog(error));
    return false;
  }
}

/**
 * Issues every document the rental's lines still need, one at a time, and
 * emails each to the Renter when the business has that on (the default).
 * `isInvoicedNow` puts one-off charges that are waiting on an invoice now.
 */
export async function issuePendingDocuments(
  deps: BillingDependencies,
  actor: IssuingActor,
  rentalId: string,
  options: { isInvoicedNow?: boolean } = {},
): Promise<IssuedBilling[]> {
  const context = await loadBillingContext(deps, actor.operatorId);
  const issued: IssuedBilling[] = [];
  for (let round = 0; round < MOST_DOCUMENTS_PER_RUN; round += 1) {
    const next = await issueNextDocument(deps, actor, context, {
      id: rentalId,
      isInvoicedNow: options.isInvoicedNow === true,
    });
    if (!next) {
      break;
    }
    issued.push(next);
  }
  if (context.isEmailedAutomatically && issued.length > 0) {
    await emailIssued(deps, actor.operatorId, context, rentalId, issued);
  }
  return issued;
}

async function emailIssued(
  deps: BillingDependencies,
  operatorId: string,
  context: BillingContext,
  rentalId: string,
  issued: readonly IssuedBilling[],
): Promise<void> {
  const rental = await withTenant(deps.database, operatorId, (tx) =>
    loadBillingRental(tx, operatorId, rentalId, false),
  );
  for (const document of rental ? issued : []) {
    await emailBillingDocument(deps, context, rental!, {
      ...document,
      amountLine: amountLineOf(document),
    });
  }
}

/**
 * After a charge, payment or correction: issues what it needs at once.
 * Never throws: the ledger line is kept either way, and the nightly run
 * issues anything left (it is safe to run again).
 */
export async function issuePendingDocumentsQuietly(
  deps: BillingDependencies,
  actor: IssuingActor,
  rentalId: string,
): Promise<IssuedBilling[]> {
  try {
    return await issuePendingDocuments(deps, actor, rentalId);
  } catch (error) {
    console.error("Issuing a rental's documents failed", describeErrorForLog(error));
    return [];
  }
}

/** "Tax invoice INV-1003 and Receipt RCT-7 issued." for the Operator's confirmation; empty when none. */
export function issuedDocumentsText(issued: readonly IssuedBilling[]): string {
  if (issued.length === 0) {
    return "";
  }
  return `${issued.map((document) => `${document.title} ${document.numberText}`).join(" and ")} issued.`;
}

/** One business's rentals with recent lines on no document. */
async function rentalsWithUnbilledLines(
  deps: BillingDependencies,
  operatorId: string,
  since: Date,
): Promise<string[]> {
  const rows = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .selectDistinct({ rentalId: ledgerLines.rentalId })
      .from(ledgerLines)
      .leftJoin(
        billingDocumentLines,
        and(
          eq(billingDocumentLines.ledgerLineId, ledgerLines.id),
          eq(billingDocumentLines.operatorId, ledgerLines.operatorId),
        ),
      )
      .where(
        and(
          eq(ledgerLines.operatorId, operatorId),
          gte(ledgerLines.createdAt, since),
          isNull(billingDocumentLines.ledgerLineId),
        ),
      ),
  );
  return rows.map((row) => row.rentalId);
}

/**
 * The nightly catch-up, after the rent run: issues whatever a failed email
 * or storage left undone, one business at a time in its own tenant context
 * (rule 3). Lines that need no document (a payment reversed before its
 * receipt) are looked at and left.
 */
export async function runBillingCatchUp(
  deps: BillingDependencies,
  isOutOfTime: () => boolean = () => false,
): Promise<OperatorRun> {
  const since = new Date(deps.now().getTime() - CATCH_UP_LOOKBACK_DAYS * MILLISECONDS_PER_DAY);
  const operatorIds = await findDueOperators(
    deps.database,
    sql`SELECT operator_id FROM app.operators_with_unbilled_lines(${since.toISOString()}::timestamptz) AS operator_id`,
  );
  return forEachOperator(
    operatorIds,
    "Issuing documents",
    (operatorId) => catchUpOperator(deps, operatorId, since),
    isOutOfTime,
  );
}

/** One business's part of the catch-up: every rental with recent lines on no document. */
export async function catchUpOperator(
  deps: BillingDependencies,
  operatorId: string,
  since: Date,
): Promise<number> {
  let issuedCount = 0;
  for (const rentalId of await rentalsWithUnbilledLines(deps, operatorId, since)) {
    issuedCount += (await issuePendingDocuments(deps, { operatorId }, rentalId)).length;
  }
  return issuedCount;
}
