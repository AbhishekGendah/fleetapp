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
  debitNotices,
  debitPlans,
  documentEmails,
  ledgerLines,
  operators,
  rentals,
  renters,
} from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { ActingUser } from "../acting-user";
import { stripeCustomerOf, usableMandateOf } from "../debits/debit-queries";
import { currentNoticeOf, NOTICE_OF_PLAN, PLAN_NOTICE_COLUMNS } from "../debits/plan-notices";
import { loadPaymentAccount } from "../payments/payment-accounts";
import { loadBusinessDetails } from "../settings/business-details";
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
  /** Its current notice's first debit day: none if never given, voided by a change, or lapsed. */
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
        ...PLAN_NOTICE_COLUMNS,
        partsDebited: PARTS_DEBITED,
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
      .leftJoin(debitNotices, NOTICE_OF_PLAN)
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
  const today = todayInTimeZone(new Date(), timeZone);
  return new Map(
    rows.map((row) => [
      row.ledgerLineId,
      {
        ledgerLineId: row.ledgerLineId,
        issuedDocumentId: row.issuedDocumentId,
        emailedOn: row.firstSentAt ? todayInTimeZone(row.firstSentAt, timeZone) : null,
        isEmailTried: row.isEmailTried,
        plan: row.plan,
        noticeDate: currentNoticeOf(row, row.partsDebited, today)?.noticeDate ?? null,
      },
    ]),
  );
}

/** How many parts of the selected plan's charge are already in a debit. */
const PARTS_DEBITED = sql<number>`(select count(*) from ${debitItems}
  where ${qualified(debitItems.ledgerLineId)} = ${qualified(debitPlans.ledgerLineId)})`.mapWith(
  Number,
);

/** Whether a plan's charge could be debited tonight on its rental, were its notice to come. */
function couldBeDebited(row: {
  plan: DebitCollectionPlan;
  status: RentalStatus;
  isPaused: boolean;
  isWeekly: boolean;
}): boolean {
  if (row.isPaused || !NOTICE_STATUSES.includes(row.status)) {
    return false;
  }
  // Next weekly debit and Split go with weekly debits: only on a long-term car out.
  return row.plan === "own_debit" || (row.status === "active" && row.isWeekly);
}

/**
 * The business's one-off charges planned for a debit whose Renter has no
 * current notice (never given, voided by a change of plan, or lapsed): not
 * reversed, with parts still to take, on a rental still open and not
 * paused, where a debit could be made (the Renter has an email, a working
 * direct debit and a Stripe customer), by rental.
 */
async function chargesAwaitingNotice(
  deps: BillingDependencies,
  operatorId: string,
  today: string,
): Promise<Map<string, string[]>> {
  const rows = await withTenant(deps.database, operatorId, async (tx) => {
    const planned = await tx
      .select({
        rentalId: debitPlans.rentalId,
        ledgerLineId: debitPlans.ledgerLineId,
        plan: debitPlans.plan,
        status: rentals.status,
        renterId: rentals.renterId,
        isPaused: sql<boolean>`${qualified(rentals.debitsPausedAt)} is not null`,
        isWeekly: sql<boolean>`${qualified(rentals.rentModel)} = 'blocks' and ${qualified(rentals.isLongTerm)}`,
        ...PLAN_NOTICE_COLUMNS,
        partsDebited: PARTS_DEBITED,
      })
      .from(debitPlans)
      .innerJoin(
        rentals,
        and(eq(rentals.id, debitPlans.rentalId), eq(rentals.operatorId, debitPlans.operatorId)),
      )
      .innerJoin(
        renters,
        and(eq(renters.id, rentals.renterId), eq(renters.operatorId, rentals.operatorId)),
      )
      .leftJoin(debitNotices, NOTICE_OF_PLAN)
      .where(
        and(
          eq(debitPlans.operatorId, operatorId),
          sql`${qualified(debitPlans.plan)}::text <> 'not_debited'`,
          inArray(rentals.status, [...NOTICE_STATUSES]),
          isNotNull(renters.email),
          sql`not exists (select 1 from ${ledgerLines} reversal
            where reversal.reverses_id = ${qualified(debitPlans.ledgerLineId)})`,
          sql`(select count(*) from ${debitItems}
            where ${qualified(debitItems.ledgerLineId)} = ${qualified(debitPlans.ledgerLineId)})
            < coalesce(${qualified(debitPlans.weeks)}, 1)`,
        ),
      );
    const untold = planned.filter(
      (row) => couldBeDebited(row) && !currentNoticeOf(row, row.partsDebited, today),
    );
    const debitable: typeof untold = [];
    for (const row of untold) {
      const [mandate, customerId] = [
        await usableMandateOf(tx, operatorId, row.renterId),
        await stripeCustomerOf(tx, operatorId, row.renterId),
      ];
      if (mandate && customerId) {
        debitable.push(row);
      }
    }
    return debitable;
  });
  const byRental = new Map<string, string[]>();
  for (const row of rows) {
    byRental.set(row.rentalId, [...(byRental.get(row.rentalId) ?? []), row.ledgerLineId]);
  }
  return byRental;
}

/**
 * One rental's charges awaiting notice: whatever is still to be invoiced is
 * issued (and so emailed), then each charge still with no current notice
 * has its invoice emailed again with its debit, as the app's own. Gives
 * back how many emails were tried.
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
      return notice?.issuedDocumentId && !notice.noticeDate ? [notice.issuedDocumentId] : [];
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

/**
 * One business's part of the notice run, while it can debit (not suspended,
 * its Stripe account ready): each rental with a charge awaiting notice.
 */
export async function sendMissingChargeNotices(
  deps: BillingDependencies,
  operatorId: string,
): Promise<number> {
  const [business, account] = await Promise.all([
    loadBusinessDetails(deps.database, operatorId),
    loadPaymentAccount(deps.database, operatorId),
  ]);
  const [operator] = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({ suspendedAt: operators.suspendedAt })
      .from(operators)
      .where(eq(operators.id, operatorId)),
  );
  if (!business || account?.state !== "ready" || !operator || operator.suspendedAt) {
    return 0;
  }
  const today = todayInTimeZone(deps.now(), business.timezone);
  let tried = 0;
  for (const [rentalId, ledgerLineIds] of await chargesAwaitingNotice(deps, operatorId, today)) {
    tried += await sendRentalNotices(deps, operatorId, rentalId, ledgerLineIds);
  }
  return tried;
}

/**
 * The nightly notice run, after invoicing: each one-off charge planned for
 * a debit with no current notice (never given: those planned before
 * notices came in, a send or Stripe read that failed; voided by a change of
 * plan; or lapsed after a pause) is emailed its invoice with its debit,
 * once a debit could be made, and its notice runs from then. One business
 * at a time in its own tenant context (rule 3). Safe to run again: a charge
 * with a current notice is never emailed by the run.
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
