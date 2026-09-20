import { getDb } from "@fleetapp/db/client";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  let database: "ok" | "error" = "ok";

  try {
    await getDb().execute(sql`select 1`);
  } catch {
    // Never leak connection strings or driver error details to the client.
    database = "error";
  }

  return NextResponse.json({ status: "ok", database });
}
