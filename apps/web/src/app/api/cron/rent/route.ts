import { NextResponse, type NextRequest } from "next/server";

import { env } from "../../../../env";
import { appDb } from "../../../../lib/app-db";
import { runBillingCatchUp } from "../../../../lib/billing/billing-run";
import { appEmailSender } from "../../../../lib/email-sender";
import { isScheduledJobRequest } from "../../../../lib/cron-auth";
import { reportProblems, runPart } from "../../../../lib/jobs/nightly-run";
import { runRentJob } from "../../../../lib/ledger/rent-job";
import { appPaymentDependencies } from "../../../../lib/payments/app-payments";
import { runStripeTidyUp } from "../../../../lib/payments/stripe-tidy-up";
import { appFileStorage } from "../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAUTHORISED_STATUS = 401;
const FAILED_STATUS = 500;
/** Seconds the run may take: every business's rentals, one business at a time. */
export const maxDuration = 300;
/**
 * The run stops starting new businesses after this, leaving a minute to
 * finish the one under way and send the alert before Vercel cuts it off
 * (review G3-7). The next night carries on: nothing is done twice (rule 20).
 */
const RUN_BUDGET_MS = 240_000;
/**
 * The daily rent run, called by Vercel's scheduler (vercel.json) just after
 * midnight in every Australian timezone: rent is charged, then every line
 * still on no document gets its invoice, credit note or receipt. Invoicing
 * runs even if the rent part fails (review G3-3); then Stripe's tidying up
 * (replaced direct debits cancelled there). Safe to call again:
 * nothing is charged or issued twice (rule 20). Answers 500 and emails AGS
 * when anything did not finish.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isScheduledJobRequest(request.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorised" }, { status: UNAUTHORISED_STATUS });
  }
  const now = new Date();
  const isOutOfTime = () => Date.now() - now.getTime() > RUN_BUDGET_MS;
  const rent = await runPart("rent", () => runRentJob(appDb, now, isOutOfTime));
  const documents = await runPart("invoices and receipts", () =>
    runBillingCatchUp(
      { database: appDb, storage: appFileStorage, emailSender: appEmailSender, now: () => now },
      isOutOfTime,
    ),
  );
  const paymentDeps = appPaymentDependencies();
  const stripe = paymentDeps
    ? await runPart("Stripe tidy-up", () => runStripeTidyUp(paymentDeps, isOutOfTime))
    : null;
  const outcomes = stripe ? [rent, documents, stripe] : [rent, documents];
  const hasProblems = await reportProblems(now, outcomes);
  return NextResponse.json(
    { rent: rent.result, documents: documents.result, stripe: stripe?.result ?? null },
    { status: hasProblems ? FAILED_STATUS : undefined },
  );
}
