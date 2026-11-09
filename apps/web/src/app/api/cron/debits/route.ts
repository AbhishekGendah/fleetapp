import { NextResponse, type NextRequest } from "next/server";

import { runDebitJob } from "../../../../lib/debits/debit-run";
import {
  refusedRun,
  reportProblems,
  runAnswer,
  runClock,
  runPart,
} from "../../../../lib/jobs/nightly-run";
import { appPaymentDependencies } from "../../../../lib/payments/app-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Seconds the run may take: its own budget, apart from the rent run's. */
export const maxDuration = 300;

/**
 * The nightly debit run (docs/plans/phase-4-slice-5.md), called by Vercel's
 * scheduler (vercel.json) two hours after the rent run, so each week's
 * invoice is out before its money moves. A business not reached tonight is
 * done tomorrow, still inside the 7 days a week can be debited in. Safe to
 * call again: nothing is debited twice (rule 20). Answers 500 and emails
 * AGS when anything did not finish; nothing to do while payments by Stripe
 * are not set up.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const refused = refusedRun(request.headers.get("authorization"));
  if (refused) {
    return refused;
  }
  const deps = appPaymentDependencies();
  if (!deps) {
    return NextResponse.json({ debits: null });
  }
  const { now, isOutOfTime } = runClock();
  const debits = await runPart("weekly debits", () => runDebitJob(deps, isOutOfTime));
  return runAnswer({ debits: debits.result }, await reportProblems(now, [debits]));
}
