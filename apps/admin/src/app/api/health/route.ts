import { isDatabaseReachable } from "@fleetapp/db/health";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
// force-dynamic also keeps the build itself from ever opening a DB
// connection: without it, Next would call GET() at build time to
// prerender this route.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const database = (await isDatabaseReachable()) ? "ok" : "error";

  return NextResponse.json({ status: "ok", database });
}
