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
  type BillingDocumentKind,
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
  debitPlans,
} from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { lockPaymentRental } from "../bonds/bond-records";
import { recordEmailTries } from "../contracts/document-copies";
import { usableMandateOf } from "../debits/debit-queries";
import { selectRentalLedger, type LedgerLineView } from "../ledger/ledger-queries";
import { loadPaymentAccount } from "../payments/payment-accounts";
import type { BillingContext, BillingDependencies } from "./billing-context";
import type { BillingRental } from "./billing-documents";
import { emailBillingDocument } from "./billing-email";

/** How a one-off charge on an invoice is collected, if the Renter pays by direct debit. */
interface ChargePlan {
  id: string;
  plan: DebitCollectionPlan;
  weeks: number | null;
  noticeDate: string | null;
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
      noticeDate: debitPlans.noticeDate,
      partsDebited: sql<number>`(select count(*) from ${debitItems}
        where ${qualified(debitItems.ledgerLineId)} = ${qualified(debitPlans.ledgerLineId)})`.mapWith(
        Number,
      ),
    })
    .from(debitPlans)
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
 * read from Stripe now. Null when there is nothing to debit with (no
 * working direct debit, no Stripe), so the email states no debit; throws
 * when Stripe can't be asked, so nothing is sent (no email, no debit).
 */
async function accountEndingFor(
  deps: BillingDependencies,
  operatorId: string,
  renterId: string,
): Promise<string | null> {
  const [mandate, account] = await Promise.all([
    withTenant(deps.database, operatorId, (tx) => usableMandateOf(tx, operatorId, renterId)),
    loadPaymentAccount(deps.database, operatorId),
  ]);
  if (!mandate || !account || !deps.payments) {
    return null;
  }
  return deps.payments.readBankAccountEnding(
    account.stripeAccountId,
    mandate.stripePaymentMethodId,
  );
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

/** What the email says of the charges, and the notice date each debited one gets once it is sent. */
interface ChargeWording {
  chargeLines: string[];
  contactLine: string;
  /** The plans whose debit the email states, each with its notice date (kept or new). */
  noticed: { planId: string; ledgerLineId: string; noticeDate: string }[];
}

function chargeWordingOf(
  context: Pick<BillingContext, "business" | "operatorName">,
  charges: readonly InvoiceCharge[],
  debit: { accountEnding: string; newNoticeDate: string } | null,
): ChargeWording {
  const noticed: ChargeWording["noticed"] = [];
  const chargeLines = charges.map((charge) => {
    const text = chargeLineText(charge.line);
    if (!debit || !isStillToDebit(charge)) {
      return text;
    }
    // A notice already given stands: the Renter was told that day.
    const noticeDate = charge.plan.noticeDate ?? debit.newNoticeDate;
    noticed.push({ planId: charge.plan.id, ledgerLineId: charge.line.id, noticeDate });
    const debitText = chargeDebitNoticeText({
      plan: charge.plan.plan,
      weeks: partsLeft(charge.plan),
      noticeDate,
      accountEnding: debit.accountEnding,
    });
    return debitText ? `${text} ${debitText}` : text;
  });
  const firstDebitOn = noticed.map((each) => each.noticeDate).sort()[0] ?? null;
  return { chargeLines, contactLine: contactLineText(context, firstDebitOn), noticed };
}

/**
 * Sets each stated plan's notice date, once, now its invoice's email went
 * (rule 19: logged), under the rental's lock then the plan's ("Lock order":
 * rental, the plan). A plan changed meanwhile to invoice only, or given a
 * date by another send, is left as it is.
 */
async function recordNoticesGiven(
  deps: BillingDependencies,
  operatorId: string,
  rentalId: string,
  noticed: ChargeWording["noticed"],
  requester: EmailRequester,
): Promise<void> {
  if (noticed.length === 0) {
    return;
  }
  await withTenant(deps.database, operatorId, async (tx) => {
    await lockPaymentRental(tx, operatorId, rentalId);
    for (const notice of noticed) {
      const [given] = await tx
        .update(debitPlans)
        .set({ noticeDate: notice.noticeDate })
        .where(
          and(
            eq(debitPlans.operatorId, operatorId),
            eq(debitPlans.id, notice.planId),
            isNull(debitPlans.noticeDate),
            sql`${qualified(debitPlans.plan)}::text <> 'not_debited'`,
          ),
        )
        .returning({ id: debitPlans.id });
      if (given) {
        await recordActivity(tx, {
          operatorId,
          actor: requester ? { type: "user", id: requester.userId } : { type: "system", id: null },
          entityType: ACTIVITY_ENTITY_TYPES.debitPlan,
          entityId: given.id,
          action: ACTIVITY_ACTIONS.noticeGiven,
          valuesAfter: { ledgerLineId: notice.ledgerLineId, noticeDate: notice.noticeDate },
        });
      }
    }
  });
}

/**
 * What the email says of an invoice's one-off charges: null when it has
 * none (rent, a credit note, a receipt), "unreachable" when Stripe can't
 * say which account a charge will be debited from.
 */
async function chargeWordingFor(
  deps: BillingDependencies,
  operatorId: string,
  context: Pick<BillingContext, "business" | "operatorName">,
  rental: Pick<BillingRental, "id" | "renterId" | "settingsSnapshot">,
  issuedDocumentId: string,
): Promise<ChargeWording | null | "unreachable"> {
  const charges = await withTenant(deps.database, operatorId, (tx) =>
    loadInvoiceCharges(tx, operatorId, rental.id, issuedDocumentId),
  );
  if (charges.length === 0) {
    return null;
  }
  if (!charges.some(isStillToDebit)) {
    return chargeWordingOf(context, charges, null);
  }
  let accountEnding: string | null;
  try {
    accountEnding = await accountEndingFor(deps, operatorId, rental.renterId);
  } catch (error) {
    console.error(
      "Reading the account a charge is debited from failed",
      describeErrorForLog(error),
    );
    return "unreachable";
  }
  // The rental's own notice period, from its settings copy (rule 14).
  const { oneOffNoticeDays } = readSettings(operatorSettingsSchema, rental.settingsSnapshot);
  const debit = accountEnding
    ? {
        accountEnding,
        newNoticeDate: oneOffNoticeDate(deps.now(), context.business.timezone, oneOffNoticeDays),
      }
    : null;
  return chargeWordingOf(context, charges, debit);
}

/**
 * Emails a billing document to the Renter (a business's contact) and
 * records the try against it (never the address: rule 7). An invoice with
 * one-off charges (docs/plans/one-off-charge-notice.md) states each charge,
 * its amount and GST, and how to reach the business; a charge to be debited
 * also its date and the account's last four digits, and once the email is
 * sent its notice date is set, so it can be debited from that day. If Stripe
 * can't say which account, nothing is sent: no email, no debit. Never
 * throws: the document is kept either way.
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
  let noticed: ChargeWording["noticed"] = [];
  try {
    const wording = rental.renterEmail
      ? await chargeWordingFor(deps, operatorId, context, rental, document.issuedDocumentId)
      : null;
    if (wording === "unreachable") {
      outcome = "failed";
    } else if (rental.renterEmail) {
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
    await recordNoticesGiven(deps, operatorId, rental.id, noticed, requester);
  } catch (error) {
    // The plan keeps no date, so it is not debited until the invoice is emailed again.
    console.error("Recording a charge's notice date failed", describeErrorForLog(error));
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
