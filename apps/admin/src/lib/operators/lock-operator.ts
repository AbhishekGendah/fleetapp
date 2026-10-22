import { operators } from "@fleetapp/db/schema";
import { eq } from "drizzle-orm";

import type { Transaction } from "./dependencies";
import { OperatorNotFoundError } from "./errors";

export interface LockedOperator {
  id: string;
  legalName: string;
  tradingName: string | null;
  suspendedAt: Date | null;
}

/**
 * Reads the Operator and holds its row until the transaction ends.
 *
 * Every action that changes an Operator's invites or suspension starts here,
 * so two at once (two resends, or a resend and a suspend) run one after the
 * other rather than both acting on what they read before the other wrote.
 */
export async function lockOperator(tx: Transaction, operatorId: string): Promise<LockedOperator> {
  const [operator] = await tx
    .select({
      id: operators.id,
      legalName: operators.legalName,
      tradingName: operators.tradingName,
      suspendedAt: operators.suspendedAt,
    })
    .from(operators)
    .where(eq(operators.id, operatorId))
    .for("update");

  if (!operator) {
    throw new OperatorNotFoundError();
  }
  return operator;
}
