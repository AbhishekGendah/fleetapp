import { describeErrorForLog, formatDateTimeInTimeZone } from "@fleetapp/core";
import { renderNightlyRunAlertEmail, type NightlyRunProblem } from "@fleetapp/email";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "../../../../env";
import { appDb } from "../../../../lib/app-db";
import { runBillingCatchUp } from "../../../../lib/billing/billing-run";
import { appEmailSender } from "../../../../lib/email-sender";
import { isScheduledJobRequest } from "../../../../lib/cron-auth";
import type { OperatorRun } from "../../../../lib/jobs/due-operators";
import { runRentJob } from "../../../../lib/ledger/rent-job";
import { appPayments } from "../../../../lib/payments/app-payments";
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
/** AGS's own clock, for the alert email only. */
const AGS_TIME_ZONE = "Australia/Perth";

type PartResult = { run: OperatorRun } | { error: true };

/** Runs one part of the night; a part that throws is logged and reported, never stops the next. */
async function runPart(
  part: string,
  work: () => Promise<OperatorRun>,
): Promise<{ part: string; result: PartResult }> {
  try {
    return { part, result: { run: await work() } };
  } catch (error) {
    console.error(`The nightly run's ${part} part stopped`, describeErrorForLog(error));
    return { part, result: { error: true } };
  }
}

function problemOf(outcome: { part: string; result: PartResult }): NightlyRunProblem | null {
  if ("error" in outcome.result) {
    return { part: outcome.part, failedBusinesses: 0, unreachedBusinesses: 0, didStop: true };
  }
  const { failedOperators, unreachedOperators } = outcome.result.run;
  return failedOperators > 0 || unreachedOperators > 0
    ? {
        part: outcome.part,
        failedBusinesses: failedOperators,
        unreachedBusinesses: unreachedOperators,
        didStop: false,
      }
    : null;
}

/** Tells AGS the run did not finish cleanly (review G3-4). A failed alert is logged, never thrown. */
async function sendAlert(startedAt: Date, problems: readonly NightlyRunProblem[]): Promise<void> {
  try {
    await appEmailSender.send(
      await renderNightlyRunAlertEmail({
        to: env.OPS_ALERT_EMAIL,
        ranAt: formatDateTimeInTimeZone(startedAt, AGS_TIME_ZONE),
        problems,
      }),
    );
  } catch (error) {
    console.error("Sending the nightly run alert failed", describeErrorForLog(error));
  }
}

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
  const payments = appPayments;
  const stripe = payments
    ? await runPart("Stripe tidy-up", () =>
        runStripeTidyUp({ database: appDb, payments, now: () => new Date() }, isOutOfTime),
      )
    : null;
  const outcomes = stripe ? [rent, documents, stripe] : [rent, documents];
  const problems = outcomes.flatMap((outcome) => problemOf(outcome) ?? []);
  if (problems.length > 0) {
    await sendAlert(now, problems);
  }
  return NextResponse.json(
    { rent: rent.result, documents: documents.result, stripe: stripe?.result ?? null },
    { status: problems.length > 0 ? FAILED_STATUS : undefined },
  );
}
