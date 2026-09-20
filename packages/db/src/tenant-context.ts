import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { TENANT_SETTING_NAME } from "./tenancy";

const operatorIdSchema = z.uuid();

/**
 * Thrown before any transaction is opened, so a bad Operator id can never
 * reach the database as an unscoped query.
 */
export class InvalidOperatorIdError extends Error {
  constructor() {
    // Deliberately carries no value: the id may come from a session or a
    // webhook, and rule 7 forbids logging identifying data.
    super("A valid Operator id is required to open a tenant-scoped transaction.");
    this.name = "InvalidOperatorIdError";
  }
}

/** The subset of a Drizzle transaction that `withTenant` itself needs. */
interface TenantAwareTransaction {
  execute(query: SQL): Promise<unknown>;
}

/** The subset of a Drizzle database that `withTenant` itself needs. */
interface TransactionCapableDatabase<TTransaction extends TenantAwareTransaction> {
  transaction<TResult>(callback: (tx: TTransaction) => Promise<TResult>): Promise<TResult>;
}

/**
 * Runs `callback` inside a transaction scoped to one Operator.
 *
 * Every query on a tenant-owned table goes through here. The Operator id comes
 * from the authenticated session, or from trusted data in a webhook or job —
 * never from request input. See rules 1 to 3 in CLAUDE.md.
 *
 * The setting is applied with `set_config(..., true)`, which makes it local to
 * this transaction. That matters on a pooled connection: the moment the
 * transaction ends, the next request on the same physical connection starts
 * with no tenant context and therefore sees nothing.
 *
 * `SET LOCAL` cannot take a bound parameter, so `set_config` is used instead —
 * it can, which keeps the Operator id out of the SQL string.
 */
export async function withTenant<TTransaction extends TenantAwareTransaction, TResult>(
  database: TransactionCapableDatabase<TTransaction>,
  operatorId: string,
  callback: (tx: TTransaction) => Promise<TResult>,
): Promise<TResult> {
  if (!operatorIdSchema.safeParse(operatorId).success) {
    throw new InvalidOperatorIdError();
  }

  return database.transaction(async (tx) => {
    await tx.execute(sql`select set_config(${TENANT_SETTING_NAME}, ${operatorId}, true)`);
    return callback(tx);
  });
}
