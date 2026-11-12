import type { NextRequest, NextResponse } from "next/server";

import { appDb } from "../../../../lib/app-db";
import type { BillingDependencies } from "../../../../lib/billing/billing-context";
import { runChargeNoticeCatchUp } from "../../../../lib/billing/charge-notice-run";
import { runBillingCatchUp } from "../../../../lib/billing/billing-run";
import { appEmailSender } from "../../../../lib/email-sender";
import {
  refusedRun,
  reportProblems,
  runAnswer,
  runClock,
  runPart,
} from "../../../../lib/jobs/nightly-run";
import { runRentJob } from "../../../../lib/ledger/rent-job";
import { appPaymentDependencies, appPayments } from "../../../../lib/payments/app-payments";
import { runStripeTidyUp } from "../../../../lib/payments/stripe-tidy-up";
import { appFileStorage } from "../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Seconds the run may take: every business's rentals, one business at a time. */
export const maxDuration = 300;

/**
 * The daily rent run, called by Vercel's scheduler (vercel.json) just after
 * midnight in every Australian timezone: rent is charged, then every line
 * still on no document gets its invoice, credit note or receipt. Invoicing
 * runs even if the rent part fails (review G3-3); then each one-off charge
 * planned for a debit whose invoice was never emailed is emailed, so its
 * notice runs from tonight (docs/plans/one-off-charge-notice.md); then
 * Stripe's tidying up (replaced direct debits cancelled there). Safe to call again:
 * nothing is charged or issued twice (rule 20). Answers 500 and emails AGS
 * when anything did not finish.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const refused = refusedRun(request.headers.get("authorization"));
  if (refused) {
    return refused;
  }
  const { now, isOutOfTime } = runClock();
  const rent = await runPart("rent", () => runRentJob(appDb, now, isOutOfTime));
  const billingDeps: BillingDependencies = {
    database: appDb,
    storage: appFileStorage,
    emailSender: appEmailSender,
    payments: appPayments,
    now: () => now,
  };
  const documents = await runPart("invoices and receipts", () =>
    runBillingCatchUp(billingDeps, isOutOfTime),
  );
  const notices = await runPart("one-off charge notices", () =>
    runChargeNoticeCatchUp(billingDeps, isOutOfTime),
  );
  const paymentDeps = appPaymentDependencies();
  const stripe = paymentDeps
    ? await runPart("Stripe tidy-up", () => runStripeTidyUp(paymentDeps, isOutOfTime))
    : null;
  const outcomes = stripe ? [rent, documents, notices, stripe] : [rent, documents, notices];
  const hasProblems = await reportProblems(now, outcomes);
  return runAnswer(
    {
      rent: rent.result,
      documents: documents.result,
      notices: notices.result,
      stripe: stripe?.result ?? null,
    },
    hasProblems,
  );
}
