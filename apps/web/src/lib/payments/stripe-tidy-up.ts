import { describeErrorForLog } from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  paymentMandates,
  renterStripeCustomers,
  renters,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, exists, isNull, sql } from "drizzle-orm";

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

/**
 * Tells Stripe the current name and email of each of the business's
 * Renters whose details changed since (review A5-6), so Stripe's
 * direct-debit notices reach the Renter. Only a Renter still holding the
 * details sent is marked done, so a change made meanwhile is sent next
 * time. Gives how many were updated.
 */
export async function syncRenterCustomers(
  deps: PaymentDependencies,
  operatorId: string,
  onlyRenterId?: string,
): Promise<number> {
  const account = await loadPaymentAccount(deps.database, operatorId);
  if (!account || account.state === "disconnected") {
    return 0;
  }
  const waiting = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({
        id: renterStripeCustomers.id,
        customerId: renterStripeCustomers.stripeCustomerId,
        renterId: renters.id,
        name: renters.fullName,
        email: renters.email,
      })
      .from(renterStripeCustomers)
      .innerJoin(renters, eq(renters.id, renterStripeCustomers.renterId))
      .where(
        and(
          eq(renterStripeCustomers.operatorId, operatorId),
          eq(renterStripeCustomers.needsUpdate, true),
          onlyRenterId ? eq(renterStripeCustomers.renterId, onlyRenterId) : undefined,
        ),
      ),
  );
  let updated = 0;
  for (const customer of waiting) {
    try {
      await deps.payments.updateCustomer(account.stripeAccountId, customer.customerId, {
        name: customer.name,
        email: customer.email,
      });
    } catch (error) {
      console.error("Updating a Renter at Stripe failed", describeErrorForLog(error));
      continue;
    }
    await withTenant(deps.database, operatorId, (tx) =>
      tx
        .update(renterStripeCustomers)
        .set({ needsUpdate: false })
        .where(
          and(
            eq(renterStripeCustomers.id, customer.id),
            exists(
              tx
                .select({ id: renters.id })
                .from(renters)
                .where(
                  and(
                    eq(renters.id, customer.renterId),
                    eq(renters.fullName, customer.name),
                    customer.email === null
                      ? isNull(renters.email)
                      : eq(renters.email, customer.email),
                  ),
                ),
            ),
          ),
        ),
    );
    updated += 1;
  }
  return updated;
}

/** One business's Stripe tidying up: replaced direct debits cancelled, Renters' details sent. */
async function tidyUpOperator(deps: PaymentDependencies, operatorId: string): Promise<number> {
  return (
    (await detachReplacedMandates(deps, operatorId)) + (await syncRenterCustomers(deps, operatorId))
  );
}

/**
 * Straight after a Renter's details are saved: Stripe is told now, not
 * only overnight. A failure is logged, never thrown; the nightly run tries again.
 */
export async function tellStripeAboutRenter(
  deps: PaymentDependencies | null,
  operatorId: string,
  renterId: string,
): Promise<void> {
  if (!deps) {
    return;
  }
  try {
    await syncRenterCustomers(deps, operatorId, renterId);
  } catch (error) {
    console.error("Telling Stripe about a Renter failed", describeErrorForLog(error));
  }
}

/**
 * The nightly part that finishes what could not be done at Stripe when it
 * happened (detaching, Renters' new details), one business at a time. Safe to run again (rule 20).
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
