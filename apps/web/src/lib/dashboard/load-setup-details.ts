import type { SetupChecklistInput } from "@fleetapp/core";
import { operators } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { eq } from "drizzle-orm";

import { appDb } from "../app-db";

export interface SetupDetails extends SetupChecklistInput {
  timezone: string;
}

/**
 * The Operator's own record, as far as the dashboard needs it. Runs on the
 * app's role inside the signed-in User's Operator, so it can only ever read
 * that one row.
 */
export async function loadSetupDetails(operatorId: string): Promise<SetupDetails | null> {
  const [row] = await withTenant(appDb, operatorId, (tx) =>
    tx
      .select({
        legalName: operators.legalName,
        abn: operators.abn,
        addressLine1: operators.addressLine1,
        suburb: operators.suburb,
        state: operators.state,
        postcode: operators.postcode,
        phone: operators.phone,
        email: operators.email,
        stripeChargesEnabled: operators.stripeChargesEnabled,
        timezone: operators.timezone,
      })
      .from(operators)
      .where(eq(operators.id, operatorId)),
  );
  return row ?? null;
}
