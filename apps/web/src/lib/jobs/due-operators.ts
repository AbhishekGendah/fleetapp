import { describeErrorForLog } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

/** What the database driver hands back from a narrow "which Operators have work" function. */
const dueOperatorsSchema = z.object({ rows: z.array(z.object({ operator_id: z.uuid() })) });

/**
 * The Operators a nightly job has work for, from one of the narrow database
 * functions that return Operator IDs only (rule 3). `query` must select
 * `operator_id`.
 */
export async function findDueOperators(database: AnyDatabase, query: SQL): Promise<string[]> {
  return dueOperatorsSchema.parse(await database.execute(query)).rows.map((row) => row.operator_id);
}

export interface OperatorRun {
  operators: number;
  /** What `work` reported doing, added up. */
  done: number;
  /** Operators skipped because something failed; the next run tries again. */
  failedOperators: number;
}

/**
 * Runs a nightly job one Operator at a time. One Operator's failure is
 * logged (never its details) and skipped, so it cannot stop the others.
 */
export async function forEachOperator(
  operatorIds: readonly string[],
  description: string,
  work: (operatorId: string) => Promise<number>,
): Promise<OperatorRun> {
  const run: OperatorRun = { operators: operatorIds.length, done: 0, failedOperators: 0 };
  for (const operatorId of operatorIds) {
    try {
      run.done += await work(operatorId);
    } catch (error) {
      run.failedOperators += 1;
      console.error(`${description} failed for an Operator`, {
        operatorId,
        ...describeErrorForLog(error),
      });
    }
  }
  return run;
}
