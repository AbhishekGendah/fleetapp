import { NextResponse, type NextRequest } from "next/server";

import { env } from "../../../../env";
import { appDb } from "../../../../lib/app-db";
import { isScheduledJobRequest } from "../../../../lib/cron-auth";
import { runFileHousekeeping } from "../../../../lib/files/file-housekeeping";
import { appFileStorage } from "../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAUTHORISED_STATUS = 401;

/** The daily file clean-up, called by Vercel's scheduler (vercel.json). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isScheduledJobRequest(request.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorised" }, { status: UNAUTHORISED_STATUS });
  }
  const summary = await runFileHousekeeping({
    database: appDb,
    storage: appFileStorage,
    now: () => new Date(),
  });
  return NextResponse.json(summary);
}
