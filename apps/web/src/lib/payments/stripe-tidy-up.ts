import { describeErrorForLog } from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, paymentMandates } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNull, sql } from "drizzle-orm";

import { findDueOperators, forEachOperator, type OperatorRun } from "../jobs/due-operators";
import { loadPaymentAccount, type PaymentDependencies } from "./payment-accounts";

const SYSTEM_ACTOR = { type: "system", id: null } as const;

/**
 * Cancels at Stripe every direct debit of the business's that was replaced
 * but is still attached there (review KS-3), so neither the business nor
 * later automation can debit the bank account the Renter moved away from.
 * Stripe is asked outside any transaction; one that fails is left for the
 * next try. Gives how many were detached.
 */
export async function detachReplacedMandates(
  deps: PaymentDependencies,
  operatorId: string,
): Promise<number> {
  const account = await loadPaymentAccount(deps.database, operatorId);
  if (!account) {
    return 0;
  }
  const replaced = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({ id: paymentMandates.id, paymentMethodId: paymentMandates.stripePaymentMethodId })
      .from(paymentMandates)
      .where(
        and(
          eq(paymentMandates.operatorId, operatorId),
          eq(paymentMandates.endReason, "replaced"),
          isNull(paymentMandates.detachedAt),
        ),
      ),
  );
  let detached = 0;
  for (const mandate of replaced) {
    try {
      await deps.payments.detachPaymentMethod(account.stripeAccountId, mandate.paymentMethodId);
    } catch (error) {
      console.error("Detaching a replaced direct debit failed", describeErrorForLog(error));
      continue;
    }
    await markDetached(deps, operatorId, mandate.id);
    detached += 1;
  }
  return detached;
}

async function markDetached(
  deps: PaymentDependencies,
  operatorId: string,
  mandateId: string,
): Promise<void> {
  const now = deps.now();
  await withTenant(deps.database, operatorId, async (tx) => {
    const [marked] = await tx
      .update(paymentMandates)
      .set({ detachedAt: now, updatedAt: now })
      .where(and(eq(paymentMandates.id, mandateId), isNull(paymentMandates.detachedAt)))
      .returning({ id: paymentMandates.id });
    if (marked) {
      await recordActivity(tx, {
        operatorId,
        actor: SYSTEM_ACTOR,
        entityType: ACTIVITY_ENTITY_TYPES.paymentMandate,
        entityId: mandateId,
        action: ACTIVITY_ACTIONS.updated,
        valuesAfter: { isDetachedAtStripe: true },
      });
    }
  });
}

/** One business's Stripe tidying up: replaced direct debits cancelled there. */
async function tidyUpOperator(deps: PaymentDependencies, operatorId: string): Promise<number> {
  return detachReplacedMandates(deps, operatorId);
}

/**
 * The nightly part that finishes what could not be done at Stripe when it
 * happened, one business at a time. Safe to run again (rule 20).
 */
export async function runStripeTidyUp(
  deps: PaymentDependencies,
  isOutOfTime: () => boolean,
): Promise<OperatorRun> {
  const operatorIds = await findDueOperators(
    deps.database,
    sql`SELECT operator_id FROM app.operators_with_stripe_tidy_up() AS operator_id`,
  );
  return forEachOperator(
    operatorIds,
    "The Stripe tidy-up",
    (operatorId) => tidyUpOperator(deps, operatorId),
    isOutOfTime,
  );
}
