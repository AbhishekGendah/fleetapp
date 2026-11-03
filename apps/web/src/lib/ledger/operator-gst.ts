import { GST_START_DATE } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { operators } from "@fleetapp/db/schema";
import { eq } from "drizzle-orm";

/** What a line's GST depends on: whether, and since when, the business is registered. */
export interface OperatorGst {
  /** Null when not registered. */
  registeredFrom: string | null;
  timeZone: string;
}

/** The business's GST registration and timezone, read inside its own tenant context. */
export async function loadOperatorGst(
  tx: AnyTransaction,
  operatorId: string,
): Promise<OperatorGst> {
  const [operator] = await tx
    .select({
      gstRegistered: operators.gstRegistered,
      gstRegisteredFrom: operators.gstRegisteredFrom,
      timezone: operators.timezone,
    })
    .from(operators)
    .where(eq(operators.id, operatorId));
  if (!operator) {
    throw new Error("The business could not be found in its own tenant context.");
  }
  return {
    // Registered with no date given: registered from the start of GST.
    registeredFrom: operator.gstRegistered ? (operator.gstRegisteredFrom ?? GST_START_DATE) : null,
    timeZone: operator.timezone,
  };
}
