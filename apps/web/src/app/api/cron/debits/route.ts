import { NextResponse, type NextRequest } from "next/server";

import { env } from "../../../../env";
import { isScheduledJobRequest } from "../../../../lib/cron-auth";
import { runDebitJob } from "../../../../lib/debits/debit-run";
import { reportProblems, runPart } from "../../../../lib/jobs/nightly-run";
import { appPaymentDependencies } from "../../../../lib/payments/app-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAUTHORISED_STATUS = 401;
const FAILED_STATUS = 500;
/** Seconds the run may take: its own budget, apart from the rent run's. */
export const maxDuration = 300;
/**
 * The run stops starting new businesses after this, leaving a minute to
 * finish the one under way and send the alert. The next night carries on,
 * still inside the 7 days a week can be debited in (rule 20).
 */
const RUN_BUDGET_MS = 240_000;

/**
 * The nightly debit run (docs/plans/phase-4-slice-5.md), called by Vercel's
 * scheduler (vercel.json) two hours after the rent run, so each week's
 * invoice is out before its money moves. Safe to call again: nothing is
 * debited twice (rule 20). Answers 500 and emails AGS when anything did not
 * finish. Nothing to do while payments by Stripe are not set up.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isScheduledJobRequest(request.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorised" }, { status: UNAUTHORISED_STATUS });
  }
  const deps = appPaymentDependencies();
  if (!deps) {
    return NextResponse.json({ debits: null });
  }
  const now = new Date();
  const isOutOfTime = () => Date.now() - now.getTime() > RUN_BUDGET_MS;
  const debits = await runPart("weekly debits", () =>
    runDebitJob({ ...deps, now: () => new Date() }, isOutOfTime),
  );
  const hasProblems = await reportProblems(now, [debits]);
  return NextResponse.json(
    { debits: debits.result },
    { status: hasProblems ? FAILED_STATUS : undefined },
  );
}
