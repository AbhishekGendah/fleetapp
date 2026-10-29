import { describeErrorForLog } from "@fleetapp/core";
import { sql } from "drizzle-orm";

import { getDb } from "./client";

/**
 * Whether the database is reachable, for the apps' health endpoints.
 *
 * Returns a plain boolean rather than throwing or passing the error out: a
 * health endpoint is public, and connection strings and driver internals must
 * never reach the client (rule 7).
 */
export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await getDb().execute(sql`select 1`);
    return true;
  } catch (error) {
    console.error("The database health check failed", describeErrorForLog(error));
    return false;
  }
}

export interface HealthReport {
  status: "ok";
  database: "ok" | "error";
}

/** What both apps' health endpoints answer. Says nothing beyond up or down. */
export async function getHealthReport(): Promise<HealthReport> {
  return { status: "ok", database: (await isDatabaseReachable()) ? "ok" : "error" };
}
