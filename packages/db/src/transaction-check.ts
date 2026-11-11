import { sql } from "drizzle-orm";
import { z } from "zod";

import type { AnyDatabase } from "./client";
import { TENANT_SETTING_NAME } from "./tenancy";
import { withTenant } from "./tenant-context";

/**
 * Set as the business for the check's own transaction. No Operator has it
 * (a version 4 UUID with every random bit zero), and the check reads and
 * writes no table, so no business's records are touched.
 */
export const TRANSACTION_CHECK_OPERATOR_ID = "00000000-0000-4000-8000-000000000000";

/** Enough statements at once that an unheld transaction spreads over several connections. */
const PARALLEL_STATEMENTS = 4;

const checkRowSchema = z.object({
  rows: z.array(z.object({ operator_id: z.string().nullable(), transaction_id: z.string() })),
});

/**
 * What would make `withTenant` unsafe on this connection: its statements not
 * all in the one transaction, or some without the business it set. Several
 * statements run at once, as `Promise.all` inside a transaction does, each
 * reporting the business set and the transaction it ran in. A driver that
 * hands each statement to whichever connection is free (the dev site, 5 to
 * 11 Nov 2026) fails here. `txid_current()` gives the transaction an id but
 * writes no data. Empty when it is safe.
 */
export async function transactionProblems(database: AnyDatabase): Promise<string[]> {
  const results = await withTenant(database, TRANSACTION_CHECK_OPERATOR_ID, (tx) =>
    Promise.all(
      Array.from({ length: PARALLEL_STATEMENTS }, () =>
        tx.execute(sql`
          SELECT current_setting(${TENANT_SETTING_NAME}, true) AS operator_id,
            txid_current()::text AS transaction_id
        `),
      ),
    ),
  );
  const rows = results.flatMap((result) => checkRowSchema.parse(result).rows);
  const transactionIds = new Set(rows.map((row) => row.transaction_id));
  return [
    rows.length !== PARALLEL_STATEMENTS ? "some statements returned nothing" : null,
    rows.some((row) => row.operator_id !== TRANSACTION_CHECK_OPERATOR_ID)
      ? "some statements ran without the business the transaction set"
      : null,
    transactionIds.size > 1 ? "statements of one transaction ran in different transactions" : null,
  ].filter((problem): problem is string => problem !== null);
}

/**
 * Refuses to start an app whose transactions don't hold together: every
 * business's records would rest on luck instead of the tenant lock (rules 1
 * and 2). Only what is wrong is said, never the connection's details.
 */
export async function assertTransactionsHold(database: AnyDatabase, which: string): Promise<void> {
  const problems = await transactionProblems(database);
  if (problems.length > 0) {
    throw new Error(
      `The ${which} database connection does not keep a transaction together: ${problems.join(", ")}. See docs/runbooks/database-roles.md.`,
    );
  }
}
