import { NextResponse, type NextRequest } from "next/server";

import { env } from "../../../../env";
import { appDb } from "../../../../lib/app-db";
import { isScheduledJobRequest } from "../../../../lib/cron-auth";
import { runFileHousekeeping } from "../../../../lib/files/file-housekeeping";
import { removeUnapprovedSubmissions } from "../../../../lib/renter-links/submission-cleanup";
import { appFileStorage } from "../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAUTHORISED_STATUS = 401;

/** The daily clean-up (unapproved Renter submissions, then files), called by Vercel's scheduler (vercel.json). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isScheduledJobRequest(request.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorised" }, { status: UNAUTHORISED_STATUS });
  }
  const deps = { database: appDb, storage: appFileStorage, now: () => new Date() };
  // Submissions first: the photos they bin are then purged by a later run.
  const submissions = await removeUnapprovedSubmissions(deps);
  const files = await runFileHousekeeping(deps);
  return NextResponse.json({ files, submissions });
}
