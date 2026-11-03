import { NextResponse, type NextRequest } from "next/server";

import { env } from "../../../../env";
import { appDb } from "../../../../lib/app-db";
import { isScheduledJobRequest } from "../../../../lib/cron-auth";
import { runRentJob } from "../../../../lib/ledger/rent-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAUTHORISED_STATUS = 401;
/** Seconds the run may take: every business's rentals, one business at a time. */
export const maxDuration = 300;

/**
 * The daily rent run, called by Vercel's scheduler (vercel.json) just after
 * midnight in every Australian timezone. Safe to call again: nothing is
 * charged twice (rule 20).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isScheduledJobRequest(request.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorised" }, { status: UNAUTHORISED_STATUS });
  }
  return NextResponse.json(await runRentJob(appDb, new Date()));
}
