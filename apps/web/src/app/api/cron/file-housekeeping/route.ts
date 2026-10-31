import { NextResponse, type NextRequest } from "next/server";

import { env } from "../../../../env";
import { appDb } from "../../../../lib/app-db";
import { isScheduledJobRequest } from "../../../../lib/cron-auth";
import { runFileHousekeeping } from "../../../../lib/files/file-housekeeping";
import { removeOldSubmissions } from "../../../../lib/renter-links/submission-cleanup";
import { binExpiredLicenceScans } from "../../../../lib/renters/scan-retention";
import { appFileStorage } from "../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAUTHORISED_STATUS = 401;

/** The daily clean-up (old Renter submissions, expired licence scans, then files), called by Vercel's scheduler (vercel.json). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isScheduledJobRequest(request.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorised" }, { status: UNAUTHORISED_STATUS });
  }
  const deps = { database: appDb, storage: appFileStorage, now: () => new Date() };
  // Binning first: what is binned today is purged by a run 30 days later.
  const submissions = await removeOldSubmissions(deps);
  const licenceScans = await binExpiredLicenceScans(deps);
  const files = await runFileHousekeeping(deps);
  return NextResponse.json({ submissions, licenceScans, files });
}
