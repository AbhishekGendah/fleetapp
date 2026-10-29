import { getHealthReport } from "@fleetapp/db/health";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Never prerendered, so the build itself never opens a database connection.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await getHealthReport());
}
