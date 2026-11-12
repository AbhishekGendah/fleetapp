import {
  chargeDebitNoticeText,
  describeErrorForLog,
  formatAustralianPhone,
  formatCents,
  formatShortCalendarDate,
  isDebitingPlan,
  isOneOffCharge,
  oneOffNoticeDate,
  operatorSettingsSchema,
  readSettings,
  todayInTimeZone,
  type BillingDocumentKind,
  type ChargeNoticeTerms,
  type DebitCollectionPlan,
  type DocumentEmailOutcome,
} from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  billingDocuments,
  debitItems,
  debitNotices,
  debitPlans,
} from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { ROW_LOCK } from "@fleetapp/db/row-lock";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, sql } from "drizzle-orm";

import { lockPaymentRental } from "../bonds/bond-records";
import { recordEmailTries } from "../contracts/document-copies";
import { stripeCustomerOf, usableMandateOf } from "../debits/debit-queries";
import {
  currentNoticeOf,
  NOTICE_OF_PLAN,
  PLAN_NOTICE_COLUMNS,
  type SelectedNotice,
} from "../debits/plan-notices";
import { selectRentalLedger, type LedgerLineView } from "../ledger/ledger-queries";
import { loadPaymentAccount } from "../payments/payment-accounts";
import type { BillingContext, BillingDependencies } from "./billing-context";
import type { BillingRental } from "./billing-documents";
import { emailBillingDocument } from "./billing-email";

/** How a one-off charge on an invoice is collected, if the Renter pays by direct debit. */
interface ChargePlan extends SelectedNotice {
  id: string;
  plan: DebitCollectionPlan;
  weeks: number | null;
  partsDebited: number;
}

/** A one-off charge on an invoice, with its plan. */
interface InvoiceCharge {
  line: LedgerLineView;
  plan: ChargePlan | null;
  isReversed: boolean;
}

/** A billing document as it is emailed: what it is, its totals and its PDF. */
export interface EmailedBillingDocument {
  issuedDocumentId: string;
  title: string;
  numberText: string | null;
  amountLine: string;
  pdf: Uint8Array;
}

/** Who asked for the email: a User pressing Email again, or the app as it issued it. */
export type EmailRequester = { userId: string } | null;

/** The one-off charges on an invoice (its fixed PDF), each with how it is collected. */
async function loadInvoiceCharges(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
  issuedDocumentId: string,
): Promise<InvoiceCharge[]> {
  const [invoice] = await tx
    .select({ id: billingDocuments.id })
    .from(billingDocuments)
    .where(
      and(
        eq(billingDocuments.operatorId, operatorId),
        eq(billingDocuments.issuedDocumentId, issuedDocumentId),
        eq(billingDocuments.kind, "invoice"),
      ),
    );
  if (!invoice) {
    return [];
  }
  const lines = await selectRentalLedger(tx, operatorId, rentalId);
  const charges = lines.filter((line) => line.documentId === invoice.id && isOneOffCharge(line));
  if (charges.length === 0) {
    return [];
  }
  const plans = await tx
    .select({
      id: debitPlans.id,
      ledgerLineId: debitPlans.ledgerLineId,
      plan: debitPlans.plan,
      weeks: debitPlans.weeks,
      ...PLAN_NOTICE_COLUMNS,
      partsDebited: sql<number>`(select count(*) from ${debitItems}
        where ${qualified(debitItems.ledgerLineId)} = ${qualified(debitPlans.ledgerLineId)})`.mapWith(
        Number,
      ),
    })
    .from(debitPlans)
    .leftJoin(debitNotices, NOTICE_OF_PLAN)
    .where(
      and(
        eq(debitPlans.operatorId, operatorId),
        inArray(
          debitPlans.ledgerLineId,
          charges.map((line) => line.id),
        ),
      ),
    );
  const reversedIds = new Set(lines.flatMap((line) => line.reversesId ?? []));
  return charges.map((line) => ({
    line,
    plan: plans.find((plan) => plan.ledgerLineId === line.id) ?? null,
    isReversed: reversedIds.has(line.id),
  }));
}

/** The parts of a charge still to be debited: none once it is all in debits. */
function partsLeft(plan: ChargePlan): number {
  const parts = plan.plan === "split" ? (plan.weeks ?? 0) : 1;
  return Math.max(parts - plan.partsDebited, 0);
}

/** A charge that will be debited: planned for a debit, not reversed, with parts still to take. */
function isStillToDebit(charge: InvoiceCharge): charge is InvoiceCharge & { plan: ChargePlan } {
  return (
    charge.plan !== null &&
    isDebitingPlan(charge.plan.plan) &&
    !charge.isReversed &&
    partsLeft(charge.plan) > 0
  );
}

/**
 * The last four digits of the account the Renter's direct debit takes from,
 * read from Stripe now. Null when no debit can be stated (the business's
 * Stripe account not ready or disconnected, no working direct debit, or
 * Stripe not answering): the invoice then goes without a debit line and
 * gives no notice, and the nightly notice run tells the Renter once a debit
 * could be made.
 */
async function accountEndingFor(
  deps: BillingDependencies,
  operatorId: string,
  renterId: string,
): Promise<string | null> {
  const [mandate, customerId, account] = await Promise.all([
    withTenant(deps.database, operatorId, (tx) => usableMandateOf(tx, operatorId, renterId)),
    withTenant(deps.database, operatorId, (tx) => stripeCustomerOf(tx, operatorId, renterId)),
    loadPaymentAccount(deps.database, operatorId),
  ]);
  if (!mandate || !customerId || account?.state !== "ready" || !deps.payments) {
    return null;
  }
  try {
    return await deps.payments.readBankAccountEnding(
      account.stripeAccountId,
      mandate.stripePaymentMethodId,
    );
  } catch (error) {
    console.error(
      "Reading the account a charge is debited from failed",
      describeErrorForLog(error),
    );
    return null;
  }
}

/** "Cleaning (Interior cleaning): $120.00, including GST of $10.91." */
function chargeLineText(line: LedgerLineView): string {
  const label = line.chargeTypeLabel ?? "Charge";
  const what = line.description === label ? label : `${label} (${line.description})`;
  const gst =
    line.gstCents > 0
      ? `including GST of ${formatCents(line.gstCents)}`
      : line.gstTreatment === "gst_free"
        ? "GST-free"
        : "no GST";
  return `${what}: ${formatCents(line.amountCents)}, ${gst}.`;
}

/** How to reach the business about a charge, before its debit if there is one. */
function contactLineText(
  context: Pick<BillingContext, "business" | "operatorName">,
  firstDebitOn: string | null,
): string {
  const { phone, email } = context.business;
  const ways = [
    phone ? `on ${formatAustralianPhone(phone)}` : null,
    email ? `at ${email}` : null,
  ].filter((way): way is string => way !== null);
  const how = ways.length > 0 ? ` ${ways.join(" or ")}` : "";
  const before = firstDebitOn ? ` before ${formatShortCalendarDate(firstDebitOn, "")}` : "";
  return `Questions about a charge? Contact ${context.operatorName}${how}${before}.`;
}

/** A notice to record once the email is sent: exactly the terms it stated. */
interface StatedNotice {
  planId: string;
  ledgerLineId: string;
  plan: DebitCollectionPlan;
  weeks: number | null;
  noticeDate: string;
  partsBefore: number;
}

/** What the email says of the charges, and the new notices it gives once sent. */
interface ChargeWording {
  chargeLines: string[];
  contactLine: string;
  noticed: StatedNotice[];
}

/**
 * Each charge's words; a charge to be debited also its window and account.
 * A notice that still covers its next part is stated again as it was; one
 * voided by a change of plan, lapsed, or never given gets a new date.
 */
function chargeWordingOf(
  context: Pick<BillingContext, "business" | "operatorName">,
  charges: readonly InvoiceCharge[],
  debit: { accountEnding: string; newNoticeDate: string; today: string } | null,
): ChargeWording {
  const noticed: StatedNotice[] = [];
  const debitDays: string[] = [];
  const chargeLines = charges.map((charge) => {
    const text = chargeLineText(charge.line);
    if (!debit || !isStillToDebit(charge)) {
      return text;
    }
    const { plan } = charge;
    const current: ChargeNoticeTerms | null = currentNoticeOf(plan, plan.partsDebited, debit.today);
    const noticeDate = current?.noticeDate ?? debit.newNoticeDate;
    if (!current) {
      noticed.push({
        planId: plan.id,
        ledgerLineId: charge.line.id,
        plan: plan.plan,
        weeks: plan.weeks,
        noticeDate,
        partsBefore: plan.partsDebited,
      });
    }
    debitDays.push(noticeDate);
    const debitText = chargeDebitNoticeText({
      plan: plan.plan,
      weeks: partsLeft(plan),
      noticeDate,
      accountEnding: debit.accountEnding,
    });
    return debitText ? `${text} ${debitText}` : text;
  });
  const firstDebitOn = debitDays.sort()[0] ?? null;
  return { chargeLines, contactLine: contactLineText(context, firstDebitOn), noticed };
}

/**
 * Records each notice the email gave, now it is sent (logged, rule 19),
 * under the rental's lock then the plan's ("Lock order": rental, the plan),
 * only while the plan still has exactly the terms the email stated and no
 * part was debited since. The database checks it gives the full notice.
 */
async function recordNoticesGiven(
  deps: BillingDependencies,
  operatorId: string,
  rentalId: string,
  given: { issuedDocumentId: string; noticed: readonly StatedNotice[] },
  requester: EmailRequester,
): Promise<void> {
  if (given.noticed.length === 0) {
    return;
  }
  await withTenant(deps.database, operatorId, async (tx) => {
    await lockPaymentRental(tx, operatorId, rentalId);
    for (const notice of given.noticed) {
      const [plan] = await tx
        .select({
          plan: debitPlans.plan,
          weeks: debitPlans.weeks,
          partsDebited: sql<number>`(select count(*) from ${debitItems}
            where ${qualified(debitItems.ledgerLineId)} = ${qualified(debitPlans.ledgerLineId)})`.mapWith(
            Number,
          ),
        })
        .from(debitPlans)
        .where(and(eq(debitPlans.operatorId, operatorId), eq(debitPlans.id, notice.planId)))
        .for(ROW_LOCK);
      const isAsStated =
        plan?.plan === notice.plan &&
        plan.weeks === notice.weeks &&
        plan.partsDebited === notice.partsBefore;
      if (!isAsStated) {
        continue;
      }
      const [recorded] = await tx
        .insert(debitNotices)
        .values({
          operatorId,
          rentalId,
          debitPlanId: notice.planId,
          plan: notice.plan,
          weeks: notice.weeks,
          noticeDate: notice.noticeDate,
          partsBefore: notice.partsBefore,
          issuedDocumentId: given.issuedDocumentId,
          givenByUserId: requester?.userId ?? null,
        })
        .returning({ id: debitNotices.id });
      await tx
        .update(debitPlans)
        .set({ noticeId: recorded!.id })
        .where(eq(debitPlans.id, notice.planId));
      await recordActivity(tx, {
        operatorId,
        actor: requester ? { type: "user", id: requester.userId } : { type: "system", id: null },
        entityType: ACTIVITY_ENTITY_TYPES.debitPlan,
        entityId: notice.planId,
        action: ACTIVITY_ACTIONS.noticeGiven,
        valuesAfter: {
          ledgerLineId: notice.ledgerLineId,
          plan: notice.plan,
          weeks: notice.weeks,
          noticeDate: notice.noticeDate,
        },
      });
    }
  });
}

/**
 * What the email says of an invoice's one-off charges: null when it has none
 * (rent, a credit note, a receipt).
 */
async function chargeWordingFor(
  deps: BillingDependencies,
  operatorId: string,
  context: Pick<BillingContext, "business" | "operatorName">,
  rental: Pick<BillingRental, "id" | "renterId" | "settingsSnapshot">,
  issuedDocumentId: string,
): Promise<ChargeWording | null> {
  const charges = await withTenant(deps.database, operatorId, (tx) =>
    loadInvoiceCharges(tx, operatorId, rental.id, issuedDocumentId),
  );
  if (charges.length === 0) {
    return null;
  }
  const accountEnding = charges.some(isStillToDebit)
    ? await accountEndingFor(deps, operatorId, rental.renterId)
    : null;
  // The rental's own notice period, from its settings copy (rule 14).
  const { oneOffNoticeDays } = readSettings(operatorSettingsSchema, rental.settingsSnapshot);
  const now = deps.now();
  const debit = accountEnding
    ? {
        accountEnding,
        newNoticeDate: oneOffNoticeDate(now, context.business.timezone, oneOffNoticeDays),
        today: todayInTimeZone(now, context.business.timezone),
      }
    : null;
  return chargeWordingOf(context, charges, debit);
}

/**
 * Emails a billing document to the Renter (a business's contact) and
 * records the try against it (never the address: rule 7). An invoice with
 * one-off charges (docs/plans/one-off-charge-notice.md) states each charge,
 * its amount and GST, and how to reach the business; a charge to be debited
 * also the days it may be taken in and the account's last four digits, and
 * once the email is sent that notice is recorded, so it can be debited in
 * those days only. When no debit can be stated (Stripe not ready, no working
 * direct debit, Stripe not answering) it goes without one and gives no
 * notice. Never throws: the document is kept either way.
 */
export async function emailBillingDocumentRecorded(
  deps: BillingDependencies,
  operatorId: string,
  context: Pick<BillingContext, "business" | "operatorName">,
  rental: Pick<
    BillingRental,
    "id" | "renterId" | "renterEmail" | "billedTo" | "rentalSummary" | "settingsSnapshot"
  >,
  document: EmailedBillingDocument,
  requester: EmailRequester,
): Promise<DocumentEmailOutcome> {
  let outcome: DocumentEmailOutcome = "no_address";
  let noticed: StatedNotice[] = [];
  try {
    if (rental.renterEmail) {
      const wording = await chargeWordingFor(
        deps,
        operatorId,
        context,
        rental,
        document.issuedDocumentId,
      );
      const isSent = await emailBillingDocument(deps, context, rental, {
        ...document,
        chargeLines: wording?.chargeLines,
        contactLine: wording?.contactLine,
      });
      outcome = isSent ? "sent" : "failed";
      noticed = isSent ? (wording?.noticed ?? []) : [];
    }
  } catch (error) {
    console.error("Emailing a billing document failed", describeErrorForLog(error));
    outcome = "failed";
  }
  await recordEmailTries(
    deps.database,
    { operatorId, documentId: document.issuedDocumentId, sentByUserId: requester?.userId ?? null },
    [{ recipient: "renter", outcome }],
  );
  try {
    await recordNoticesGiven(
      deps,
      operatorId,
      rental.id,
      { issuedDocumentId: document.issuedDocumentId, noticed },
      requester,
    );
  } catch (error) {
    // No notice is kept, so nothing is debited: the nightly notice run emails it again.
    console.error("Recording a charge's notice failed", describeErrorForLog(error));
  }
  return outcome;
}

/**
 * Whether a document is always emailed, whatever "email automatically"
 * says: an invoice with one-off charges on it, or a credit note taking one
 * back, so the Renter hears of a one-off charge and of its correction
 * (docs/plans/one-off-charge-notice.md).
 */
export async function isAlwaysEmailed(
  deps: BillingDependencies,
  operatorId: string,
  rentalId: string,
  document: { kind: BillingDocumentKind; billingDocumentId: string; issuedDocumentId: string },
): Promise<boolean> {
  if (document.kind === "invoice") {
    const charges = await withTenant(deps.database, operatorId, (tx) =>
      loadInvoiceCharges(tx, operatorId, rentalId, document.issuedDocumentId),
    );
    return charges.length > 0;
  }
  if (document.kind !== "credit_note") {
    return false;
  }
  const lines = await withTenant(deps.database, operatorId, (tx) =>
    selectRentalLedger(tx, operatorId, rentalId),
  );
  const oneOffIds = new Set(lines.filter(isOneOffCharge).map((line) => line.id));
  return lines.some(
    (line) =>
      line.documentId === document.billingDocumentId &&
      line.reversesId !== null &&
      oneOffIds.has(line.reversesId),
  );
}
