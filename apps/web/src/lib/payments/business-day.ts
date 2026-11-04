import { todayInTimeZone } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { operators } from "@fleetapp/db/schema";
import { eq } from "drizzle-orm";

/** The business's own day a moment fell on, in its timezone (rule 10). */
export async function businessDayOf(
  tx: AnyTransaction,
  operatorId: string,
  moment: Date,
): Promise<string> {
  const [operator] = await tx
    .select({ timeZone: operators.timezone })
    .from(operators)
    .where(eq(operators.id, operatorId));
  if (!operator) {
    throw new Error("The payment's business was not found.");
  }
  return todayInTimeZone(moment, operator.timeZone);
}
