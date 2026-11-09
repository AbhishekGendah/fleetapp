import { debitPlansOffered, type DebitCollectionPlan, type RentalStatus } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  debitItems,
  debitPlans,
  ledgerLines,
} from "@fleetapp/db/schema";
import { ROW_LOCK } from "@fleetapp/db/row-lock";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { lockPaymentRental } from "../bonds/bond-records";
import { loadPaymentAccount, type PaymentDependencies } from "../payments/payment-accounts";
import type { DebitCollection } from "./debit-plan-input";
import { usableMandateOf } from "./debit-queries";
import { reserveOwnDebit } from "./debit-reserve";
import { sendReservedDebit } from "./debit-send";

/** The rental states a one-off charge can still be debited in. */
const DEBITABLE_STATUSES: ReadonlySet<RentalStatus> = new Set(["booked", "active", "returned"]);

/**
 * The ways a one-off charge on this rental can be collected, or none when
 * the choice isn't offered: the business takes Stripe payments and the
 * Renter has a working direct debit. The weekly ones only while the car is out.
 */
export async function collectionChoicesFor(
  tx: AnyTransaction,
  operatorId: string,
  rental: { renterId: string; status: RentalStatus },
  isStripeReady: boolean,
): Promise<DebitCollectionPlan[]> {
  if (!isStripeReady || !DEBITABLE_STATUSES.has(rental.status)) {
    return [];
  }
  const mandate = await usableMandateOf(tx, operatorId, rental.renterId);
  return mandate ? debitPlansOffered(rental.status === "active") : [];
}

/** Whether the business's Stripe account can take payments now (the choice is offered only then). */
export async function isStripeReadyFor(
  database: AnyDatabase,
  operatorId: string,
): Promise<boolean> {
  return (await loadPaymentAccount(database, operatorId))?.state === "ready";
}

/**
 * Keeps how a new one-off charge is collected, in the transaction that adds
 * it, under the rental's lock ("Lock order": rental, then the charge and its
 * plan). Refused (false) when that way isn't offered for this rental now.
 */
export async function recordDebitPlan(
  tx: AnyTransaction,
  actor: ActingUser,
  rental: { id: string; renterId: string; status: RentalStatus },
  ledgerLineId: string,
  collection: DebitCollection & { isStripeReady: boolean },
): Promise<boolean> {
  const offered = await collectionChoicesFor(
    tx,
    actor.operatorId,
    rental,
    collection.isStripeReady,
  );
  if (!offered.includes(collection.plan)) {
    return false;
  }
  const [plan] = await tx
    .insert(debitPlans)
    .values({
      operatorId: actor.operatorId,
      rentalId: rental.id,
      ledgerLineId,
      plan: collection.plan,
      weeks: collection.weeks,
      chosenByUserId: actor.userId,
    })
    .returning({ id: debitPlans.id });
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.debitPlan,
    entityId: plan!.id,
    action: ACTIVITY_ACTIONS.created,
    valuesAfter: { ledgerLineId, plan: collection.plan, weeks: collection.weeks },
  });
  return true;
}

export type DebitPlanChange =
  "changed" | "not_found" | "already_debited" | "not_offered" | "reversed";

/** Whether a charge was reversed: it is no longer owed, so never collected. */
async function isLineReversed(
  tx: AnyTransaction,
  operatorId: string,
  ledgerLineId: string,
): Promise<boolean> {
  const [reversal] = await tx
    .select({ id: ledgerLines.id })
    .from(ledgerLines)
    .where(and(eq(ledgerLines.operatorId, operatorId), eq(ledgerLines.reversesId, ledgerLineId)))
    .limit(1);
  return reversal !== undefined;
}

/**
 * Changes how a one-off charge is collected, until any part of it is in a
 * debit (the database refuses it after), logged. The rental first, then the
 * plan ("Lock order").
 */
export async function changeDebitPlan(
  database: AnyDatabase,
  actor: ActingUser,
  target: { rentalId: string; ledgerLineId: string },
  collection: DebitCollection,
): Promise<DebitPlanChange> {
  const isStripeReady = await isStripeReadyFor(database, actor.operatorId);
  return withTenant(database, actor.operatorId, async (tx): Promise<DebitPlanChange> => {
    const rental = await lockPaymentRental(tx, actor.operatorId, target.rentalId);
    const [plan] = await tx
      .select({ id: debitPlans.id, plan: debitPlans.plan, weeks: debitPlans.weeks })
      .from(debitPlans)
      .where(
        and(
          eq(debitPlans.operatorId, actor.operatorId),
          eq(debitPlans.rentalId, target.rentalId),
          eq(debitPlans.ledgerLineId, target.ledgerLineId),
        ),
      )
      .for(ROW_LOCK);
    if (!rental || !plan) {
      return "not_found";
    }
    const [debited] = await tx
      .select({ id: debitItems.id })
      .from(debitItems)
      .where(
        and(
          eq(debitItems.operatorId, actor.operatorId),
          eq(debitItems.ledgerLineId, target.ledgerLineId),
        ),
      )
      .limit(1);
    if (debited) {
      return "already_debited";
    }
    if (await isLineReversed(tx, actor.operatorId, target.ledgerLineId)) {
      return "reversed";
    }
    const offered = await collectionChoicesFor(
      tx,
      actor.operatorId,
      { renterId: rental.renterId, status: rental.status as RentalStatus },
      isStripeReady,
    );
    if (!offered.includes(collection.plan)) {
      return "not_offered";
    }
    await tx
      .update(debitPlans)
      .set({
        plan: collection.plan,
        weeks: collection.weeks,
        chosenByUserId: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(debitPlans.id, plan.id));
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.debitPlan,
      entityId: plan.id,
      action: ACTIVITY_ACTIONS.updated,
      valuesBefore: { plan: plan.plan, weeks: plan.weeks },
      valuesAfter: { plan: collection.plan, weeks: collection.weeks },
    });
    return "changed";
  });
}

/**
 * "Take it now": the charge debited on its own, reserved in its own short
 * transaction with the rental locked first, then sent to Stripe after it.
 * Whether it was asked for (false when nothing could be: no working direct
 * debit, nothing owing, or already in a debit).
 */
export async function collectChargeNow(
  deps: PaymentDependencies,
  actor: ActingUser,
  target: { rentalId: string; ledgerLineId: string },
): Promise<boolean> {
  const { operatorId } = actor;
  const reserved = await withTenant(deps.database, operatorId, async (tx) => {
    const rental = await lockPaymentRental(tx, operatorId, target.rentalId);
    return rental
      ? reserveOwnDebit(
          tx,
          actor,
          { id: rental.id, renterId: rental.renterId },
          target.ledgerLineId,
          deps.now(),
        )
      : null;
  });
  if (!reserved) {
    return false;
  }
  await sendReservedDebit(deps, operatorId, reserved);
  return true;
}
