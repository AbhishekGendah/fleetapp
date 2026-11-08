import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Client } from "pg";
import { z } from "zod";

import { MIGRATIONS_FOLDER } from "../src/migrate";

/**
 * For tests that run an update on a database filled as the deployed code
 * fills it (progress.md "Open items"): the repo's updates as an older
 * checkout has them, each role's address in a database of the test's own,
 * and one statement as a role in an Operator's tenant context.
 */

export const OWNER_ROLE = "fleetapp_test_owner";

const journalSchema = z.looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) });

/** A copy of the repo's updates up to and including `lastTag`, as an older checkout has them. */
export function updatesUpTo(lastTag: string, folder: string): void {
  const journalPath = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json");
  const journal = journalSchema.parse(JSON.parse(readFileSync(journalPath, "utf8")));
  const last = journal.entries.findIndex((entry) => entry.tag === lastTag);
  const entries = journal.entries.slice(0, last + 1);
  mkdirSync(path.join(folder, "meta"), { recursive: true });
  for (const entry of entries) {
    copyFileSync(
      path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
      path.join(folder, `${entry.tag}.sql`),
    );
  }
  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
}

/** A role's address in the test's own database. */
export function urlFor(role: string, base: string, databaseName: string): string {
  const url = new URL(base);
  url.username = role;
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/** One statement as a role, in the given Operator's tenant context. */
export async function asRole<Row extends Record<string, unknown>>(
  client: Client,
  operatorId: string | null,
  query: string,
  values: unknown[] = [],
): Promise<Row[]> {
  await client.query("begin");
  try {
    if (operatorId) {
      await client.query("select set_config('app.operator_id', $1, true)", [operatorId]);
    }
    const result = await client.query<Row>(query, values);
    await client.query("commit");
    return result.rows;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
