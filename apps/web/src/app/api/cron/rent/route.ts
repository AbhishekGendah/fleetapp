import { NextResponse, type NextRequest } from "next/server";

import { env } from "../../../../env";
import { appDb } from "../../../../lib/app-db";
import { runBillingCatchUp } from "../../../../lib/billing/billing-run";
import { appEmailSender } from "../../../../lib/email-sender";
import { isScheduledJobRequest } from "../../../../lib/cron-auth";
import { runRentJob } from "../../../../lib/ledger/rent-job";
import { appFileStorage } from "../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAUTHORISED_STATUS = 401;
/** Seconds the run may take: every business's rentals, one business at a time. */
export const maxDuration = 300;

/**
 * The daily rent run, called by Vercel's scheduler (vercel.json) just after
 * midnight in every Australian timezone: rent is charged, then every line
 * still on no document gets its invoice, credit note or receipt. Safe to
 * call again: nothing is charged or issued twice (rule 20).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isScheduledJobRequest(request.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorised" }, { status: UNAUTHORISED_STATUS });
  }
  const now = new Date();
  const rent = await runRentJob(appDb, now);
  const documents = await runBillingCatchUp({
    database: appDb,
    storage: appFileStorage,
    emailSender: appEmailSender,
    now: () => now,
  });
  return NextResponse.json({ rent, documents });
}
