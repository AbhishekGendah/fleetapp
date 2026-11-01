import { describeErrorForLog } from "@fleetapp/core";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "../../../../env";
import { appDb } from "../../../../lib/app-db";
import { isScheduledJobRequest } from "../../../../lib/cron-auth";
import { runFileHousekeeping } from "../../../../lib/files/file-housekeeping";
import { removeOldSubmissions } from "../../../../lib/renter-links/submission-cleanup";
import { RENTAL_RETENTION_HOLDS } from "../../../../lib/rentals/retention-holds";
import { binExpiredLicenceScans } from "../../../../lib/renters/scan-retention";
import { appFileStorage } from "../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAUTHORISED_STATUS = 401;
/** Seconds the nightly run may take; each part works in limited batches well inside it. */
export const maxDuration = 300;

/** One part of the nightly run: its summary, or that it failed (logged, never its details). */
async function runPart<Summary>(
  description: string,
  part: () => Promise<Summary>,
): Promise<Summary | { failed: true }> {
  try {
    return await part();
  } catch (error) {
    console.error(`${description} failed`, describeErrorForLog(error));
    return { failed: true };
  }
}

/** The daily clean-up (old Renter submissions, expired licence scans, then files), called by Vercel's scheduler (vercel.json). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isScheduledJobRequest(request.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorised" }, { status: UNAUTHORISED_STATUS });
  }
  const deps = { database: appDb, storage: appFileStorage, now: () => new Date() };
  // Binning first: what is binned today is purged by a run 30 days later.
  // Each part runs on its own, so one failing never stops the others.
  const submissions = await runPart("Submission clean-up", () => removeOldSubmissions(deps));
  const licenceScans = await runPart("Licence scan retention", () =>
    binExpiredLicenceScans(deps, RENTAL_RETENTION_HOLDS),
  );
  const files = await runPart("File clean-up", () => runFileHousekeeping(deps));
  return NextResponse.json({ submissions, licenceScans, files });
}
