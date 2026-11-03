import {
  canTakeStripePayments,
  paymentAccountState,
  type SetupChecklistInput,
} from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { operators, stripeAccounts } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { eq } from "drizzle-orm";

export interface SetupDetails extends SetupChecklistInput {
  timezone: string;
}

/**
 * The Operator's own record, as far as the dashboard needs it. Runs on the
 * app's role inside the signed-in User's Operator, so it can only ever read
 * that one row.
 */
export async function loadSetupDetails(
  database: AnyDatabase,
  operatorId: string,
): Promise<SetupDetails | null> {
  const [row] = await withTenant(database, operatorId, (tx) =>
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
        timezone: operators.timezone,
        cardPayments: stripeAccounts.cardPayments,
        becsDebitPayments: stripeAccounts.becsDebitPayments,
        requirementsDue: stripeAccounts.requirementsDue,
      })
      .from(operators)
      .leftJoin(stripeAccounts, eq(stripeAccounts.operatorId, operators.id))
      .where(eq(operators.id, operatorId)),
  );
  if (!row) {
    return null;
  }
  const { cardPayments, becsDebitPayments, requirementsDue, ...details } = row;
  // The business's Stripe account (slice 3), ready once Stripe says so.
  const state = paymentAccountState(
    cardPayments && becsDebitPayments && requirementsDue !== null
      ? { cardPayments, becsDebitPayments, requirementsDue }
      : null,
  );
  return { ...details, stripeChargesEnabled: canTakeStripePayments(state) };
}
