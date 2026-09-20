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
  } catch {
    return false;
  }
}
