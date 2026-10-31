import { operatorDisplayName } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { operators } from "@fleetapp/db/schema";
import { eq } from "drizzle-orm";

/** Who a Renter's link and emails are from: the Operator's business, and where replies go. */
export interface LinkSender {
  operatorName: string;
  replyTo: string | undefined;
  /** The Operator's timezone: "today" on a link's form is the Operator's today. */
  timeZone: string;
}

export async function loadLinkSender(tx: AnyTransaction, operatorId: string): Promise<LinkSender> {
  const [operator] = await tx
    .select({
      legalName: operators.legalName,
      tradingName: operators.tradingName,
      email: operators.email,
      timeZone: operators.timezone,
    })
    .from(operators)
    .where(eq(operators.id, operatorId));
  if (!operator) {
    throw new Error("The link's Operator was not found.");
  }
  return {
    operatorName: operatorDisplayName(operator),
    replyTo: operator.email ?? undefined,
    timeZone: operator.timeZone,
  };
}
