import { operatorDisplayName, type PrivacyNoticeBusiness } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { operators } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { eq } from "drizzle-orm";

/** The business as its Renters' privacy notice names it: who, how to reach it, its policy. */
export async function loadNoticeBusiness(
  database: AnyDatabase,
  operatorId: string,
): Promise<PrivacyNoticeBusiness> {
  const [operator] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        legalName: operators.legalName,
        tradingName: operators.tradingName,
        email: operators.email,
        phone: operators.phone,
        privacyPolicyUrl: operators.privacyPolicyUrl,
      })
      .from(operators)
      .where(eq(operators.id, operatorId)),
  );
  if (!operator) {
    throw new Error("The privacy notice's Operator was not found.");
  }
  return {
    name: operatorDisplayName(operator),
    email: operator.email,
    phone: operator.phone,
    privacyPolicyUrl: operator.privacyPolicyUrl,
  };
}
