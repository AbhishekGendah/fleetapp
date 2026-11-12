import {
  billingDocumentTitle,
  isDebitingPlan,
  todayInTimeZone,
  type BillingDocumentKind,
  type DebitCollectionPlan,
  type RentalStatus,
} from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import {
  billingDocumentLines,
  billingDocuments,
  debitItems,
  debitPlans,
  documentEmails,
  ledgerLines,
  rentals,
} from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { ActingUser } from "../acting-user";
import { findDueOperators, forEachOperator, type OperatorRun } from "../jobs/due-operators";
import { DOCUMENT_OF_LINE, LINE_ON_DOCUMENT } from "../ledger/ledger-queries";
import {
  loadBillingContext,
  type BillingContext,
  type BillingDependencies,
} from "./billing-context";
import { loadBillingRental, type BillingRental } from "./billing-documents";
import { amountLineOf } from "./billing-email";
import { readIssuedPdf } from "./billing-queries";
import { issuePendingDocuments } from "./billing-run";
import { emailBillingDocumentRecorded, type EmailRequester } from "./charge-notices";

/** Rentals a one-off charge can still be debited on, so whose Renter still needs telling. */
const NOTICE_STATUSES: readonly RentalStatus[] = ["booked", "active", "returned"];

/** What the business sees of a one-off charge's invoice email and its debit. */
export interface ChargeNotice {
  ledgerLineId: string;
  /** The invoice it is on (its fixed PDF), for Email again; none until it is issued. */
  issuedDocumentId: string | null;
  /** The day its invoice was first emailed, on the business's calendar; none if never. */
  emailedOn: string | null;
  /** Whether emailing its invoice was ever tried (sent, failed or no address). */
  isEmailTried: boolean;
  plan: DebitCollectionPlan | null;
  noticeDate: string | null;
}

/**
 * Each of the rental's one-off charges, with its invoice, whether that
 * invoice's email went, and its plan's notice date (docs/plans/
 * one-off-charge-notice.md), by ledger line.
 */
export async function loadChargeNotices(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
  timeZone: string,
): Promise<ReadonlyMap<string, ChargeNotice>> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        ledgerLineId: ledgerLines.id,
        issuedDocumentId: billingDocuments.issuedDocumentId,
        firstSentAt: sql<Date | null>`(select min(${qualified(documentEmails.triedAt)})
          from ${documentEmails}
          where ${qualified(documentEmails.operatorId)} = ${qualified(ledgerLines.operatorId)}
            and ${qualified(documentEmails.documentId)} = ${qualified(billingDocuments.issuedDocumentId)}
            and ${qualified(documentEmails.outcome)} = 'sent')`.mapWith(documentEmails.triedAt),
        isEmailTried: sql<boolean>`exists (select 1 from ${documentEmails}
          where ${qualified(documentEmails.operatorId)} = ${qualified(ledgerLines.operatorId)}
            and ${qualified(documentEmails.documentId)} = ${qualified(billingDocuments.issuedDocumentId)})`,
        plan: debitPlans.plan,
        noticeDate: debitPlans.noticeDate,
      })
      .from(ledgerLines)
      .leftJoin(billingDocumentLines, LINE_ON_DOCUMENT)
      .leftJoin(billingDocuments, DOCUMENT_OF_LINE)
      .leftJoin(
        debitPlans,
        and(
          eq(debitPlans.ledgerLineId, ledgerLines.id),
          eq(debitPlans.operatorId, ledgerLines.operatorId),
        ),
      )
      .where(
        and(
          eq(ledgerLines.operatorId, operatorId),
          eq(ledgerLines.rentalId, rentalId),
          eq(ledgerLines.kind, "charge"),
          isNull(ledgerLines.periodStart),
          isNull(ledgerLines.periodStartsAt),
        ),
      ),
  );
  return new Map(
    rows.map((row) => [
      row.ledgerLineId,
      {
        ledgerLineId: row.ledgerLineId,
        issuedDocumentId: row.issuedDocumentId,
        emailedOn: row.firstSentAt ? todayInTimeZone(row.firstSentAt, timeZone) : null,
        isEmailTried: row.isEmailTried,
        plan: row.plan,
        noticeDate: row.noticeDate,
      },
    ]),
  );
}

/**
 * The business's one-off charges planned for a debit whose Renter has not
 * been told yet (no notice date): not reversed, with parts still to take,
 * on a rental still open, by rental.
 */
async function chargesAwaitingNotice(
  deps: BillingDependencies,
  operatorId: string,
): Promise<Map<string, string[]>> {
  const rows = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({ rentalId: debitPlans.rentalId, ledgerLineId: debitPlans.ledgerLineId })
      .from(debitPlans)
      .innerJoin(
        rentals,
        and(eq(rentals.id, debitPlans.rentalId), eq(rentals.operatorId, debitPlans.operatorId)),
      )
      .where(
        and(
          eq(debitPlans.operatorId, operatorId),
          isNull(debitPlans.noticeDate),
          sql`${qualified(debitPlans.plan)}::text <> 'not_debited'`,
          inArray(rentals.status, [...NOTICE_STATUSES]),
          sql`not exists (select 1 from ${ledgerLines} reversal
            where reversal.reverses_id = ${qualified(debitPlans.ledgerLineId)})`,
          sql`(select count(*) from ${debitItems}
            where ${qualified(debitItems.ledgerLineId)} = ${qualified(debitPlans.ledgerLineId)})
            < coalesce(${qualified(debitPlans.weeks)}, 1)`,
        ),
      ),
  );
  const byRental = new Map<string, string[]>();
  for (const row of rows) {
    byRental.set(row.rentalId, [...(byRental.get(row.rentalId) ?? []), row.ledgerLineId]);
  }
  return byRental;
}

/**
 * One rental's charges awaiting notice: whatever is still to be invoiced is
 * issued (and so emailed), then each charge whose invoice was never emailed
 * at all gets it now, as the app's own. A charge whose email was tried and
 * failed is left for the business's Email again (the screen says so).
 * Gives back how many emails were tried.
 */
async function sendRentalNotices(
  deps: BillingDependencies,
  operatorId: string,
  rentalId: string,
  ledgerLineIds: readonly string[],
): Promise<number> {
  const issued = await issuePendingDocuments(deps, { operatorId }, rentalId);
  const context = await loadBillingContext(deps, operatorId);
  const notices = await loadChargeNotices(
    deps.database,
    operatorId,
    rentalId,
    context.business.timezone,
  );
  const untold = new Set(
    ledgerLineIds.flatMap((id) => {
      const notice = notices.get(id);
      return notice?.issuedDocumentId && !notice.isEmailTried ? [notice.issuedDocumentId] : [];
    }),
  );
  if (untold.size === 0) {
    return issued.length;
  }
  const [rental, documents] = await Promise.all([
    withTenant(deps.database, operatorId, (tx) =>
      loadBillingRental(tx, operatorId, rentalId, false),
    ),
    loadInvoiceRows(deps, operatorId, [...untold]),
  ]);
  if (!rental) {
    return issued.length;
  }
  for (const document of documents) {
    await emailUntoldInvoice(deps, operatorId, context, rental, document, null);
  }
  return issued.length + documents.length;
}

/** An invoice as it is emailed again from its stored PDF. */
interface InvoiceRow {
  issuedDocumentId: string;
  kind: BillingDocumentKind;
  isTaxDocument: boolean;
  numberText: string;
  totalCents: number;
  gstCents: number;
}

function loadInvoiceRows(
  deps: BillingDependencies,
  operatorId: string,
  issuedDocumentIds: readonly string[],
): Promise<InvoiceRow[]> {
  return withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({
        issuedDocumentId: billingDocuments.issuedDocumentId,
        kind: billingDocuments.kind,
        isTaxDocument: billingDocuments.isTaxDocument,
        numberText: billingDocuments.numberText,
        totalCents: billingDocuments.totalCents,
        gstCents: billingDocuments.gstCents,
      })
      .from(billingDocuments)
      .where(
        and(
          eq(billingDocuments.operatorId, operatorId),
          inArray(billingDocuments.issuedDocumentId, [...issuedDocumentIds]),
        ),
      ),
  );
}

/** An invoice emailed now from its stored PDF: the app's own, or a User's. */
async function emailUntoldInvoice(
  deps: BillingDependencies,
  operatorId: string,
  context: BillingContext,
  rental: BillingRental,
  document: InvoiceRow,
  requester: EmailRequester,
): Promise<void> {
  const pdf = await readIssuedPdf(deps, operatorId, document.issuedDocumentId);
  if (!pdf) {
    console.error("An invoice to email for a charge's notice could not be read");
    return;
  }
  await emailBillingDocumentRecorded(
    deps,
    operatorId,
    context,
    rental,
    {
      issuedDocumentId: document.issuedDocumentId,
      title: billingDocumentTitle(document.kind, document.isTaxDocument),
      numberText: document.numberText,
      amountLine: amountLineOf({ ...document, balanceAfterCents: null }),
      pdf,
    },
    requester,
  );
}

/** One business's part of the catch-up: each rental with a charge awaiting notice. */
export async function sendMissingChargeNotices(
  deps: BillingDependencies,
  operatorId: string,
): Promise<number> {
  let tried = 0;
  for (const [rentalId, ledgerLineIds] of await chargesAwaitingNotice(deps, operatorId)) {
    tried += await sendRentalNotices(deps, operatorId, rentalId, ledgerLineIds);
  }
  return tried;
}

/**
 * The nightly notice catch-up, after invoicing: each one-off charge planned
 * for a debit whose invoice was never emailed (those already planned when
 * notices came in, or a send cut short) is invoiced and emailed now, and
 * its notice period runs from then. One business at a time in its own
 * tenant context (rule 3). Safe to run again: a charge whose email was
 * tried is never sent again by the run.
 */
export async function runChargeNoticeCatchUp(
  deps: BillingDependencies,
  isOutOfTime: () => boolean = () => false,
): Promise<OperatorRun> {
  const operatorIds = await findDueOperators(
    deps.database,
    sql`SELECT operator_id FROM app.operators_with_charge_notices_due() AS operator_id`,
  );
  return forEachOperator(
    operatorIds,
    "One-off charge notices",
    (operatorId) => sendMissingChargeNotices(deps, operatorId),
    isOutOfTime,
  );
}

/**
 * Makes sure the Renter is told of one charge planned for a debit: its
 * invoice issued (and so emailed) if it is still to be, or, when its plan
 * has no notice date yet (first planned as invoice only, or its email never
 * went), emailed again now with the debit stated, as the User's. Gives back
 * the charge's notice as it then stands.
 */
export async function giveChargeNotice(
  deps: BillingDependencies,
  actor: ActingUser,
  target: { rentalId: string; ledgerLineId: string },
): Promise<ChargeNotice | null> {
  const { operatorId } = actor;
  const context = await loadBillingContext(deps, operatorId);
  const noticeOf = async () =>
    (
      await loadChargeNotices(deps.database, operatorId, target.rentalId, context.business.timezone)
    ).get(target.ledgerLineId) ?? null;
  const notice = await noticeOf();
  if (!notice?.plan || !isDebitingPlan(notice.plan) || notice.noticeDate) {
    return notice;
  }
  if (!notice.issuedDocumentId) {
    await issuePendingDocuments(deps, actor, target.rentalId);
    return noticeOf();
  }
  const [rental, documents] = await Promise.all([
    withTenant(deps.database, operatorId, (tx) =>
      loadBillingRental(tx, operatorId, target.rentalId, false),
    ),
    loadInvoiceRows(deps, operatorId, [notice.issuedDocumentId]),
  ]);
  const [document] = documents;
  if (rental && document) {
    await emailUntoldInvoice(deps, operatorId, context, rental, document, {
      userId: actor.userId,
    });
  }
  return noticeOf();
}
