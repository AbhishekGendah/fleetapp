import {
  isStripeAccountId,
  paymentAccountState,
  type PaymentAccountState,
  type PaymentAccountStatus,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { recordActivity } from "@fleetapp/db/activity";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, stripeAccounts } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { ActingUser } from "../acting-user";
import { loadBusinessDetails } from "../settings/business-details";
import type {
  CheckoutOutcome,
  OnboardingUrls,
  PaymentEventNotice,
  PaymentsProvider,
} from "./payments-provider";
import { applyCheckoutOutcome, applyMandateStatus } from "./renter-payment-records";

/** What the payments code needs: the database, Stripe (or its stand-in) and the clock. */
export interface PaymentDependencies {
  database: AnyDatabase;
  payments: PaymentsProvider;
  now: () => Date;
}

export interface PaymentAccountView {
  stripeAccountId: string;
  isLive: boolean;
  status: PaymentAccountStatus;
  state: PaymentAccountState;
  checkedAt: Date | null;
}

const SYSTEM_ACTOR = { type: "system", id: null } as const;

function selectAccount(tx: AnyTransaction, operatorId: string) {
  return tx.select().from(stripeAccounts).where(eq(stripeAccounts.operatorId, operatorId));
}

/** The business's Stripe account as Stripe last described it, or null if not connected. */
export async function loadPaymentAccount(
  database: AnyDatabase,
  operatorId: string,
): Promise<PaymentAccountView | null> {
  const [row] = await withTenant(database, operatorId, (tx) => selectAccount(tx, operatorId));
  if (!row) {
    return null;
  }
  const status = {
    cardPayments: row.cardPayments,
    becsDebitPayments: row.becsDebitPayments,
    requirementsDue: row.requirementsDue,
  };
  return {
    stripeAccountId: row.stripeAccountId,
    isLive: row.isLive,
    status,
    state: paymentAccountState(status),
    checkedAt: row.checkedAt,
  };
}

/** Writes what Stripe said, and logs it when the account's state changes (amounts of nothing, rule 7). */
async function saveStatus(
  tx: AnyTransaction,
  operatorId: string,
  status: PaymentAccountStatus,
  now: Date,
): Promise<void> {
  const [before] = await selectAccount(tx, operatorId);
  if (!before) {
    return;
  }
  await tx
    .update(stripeAccounts)
    .set({ ...status, checkedAt: now, updatedAt: now })
    .where(eq(stripeAccounts.operatorId, operatorId));
  const stateBefore = paymentAccountState(before);
  const stateAfter = paymentAccountState(status);
  if (stateBefore !== stateAfter) {
    await recordActivity(tx, {
      operatorId,
      actor: SYSTEM_ACTOR,
      entityType: ACTIVITY_ENTITY_TYPES.stripeAccount,
      entityId: operatorId,
      action: ACTIVITY_ACTIONS.updated,
      valuesBefore: { state: stateBefore },
      valuesAfter: { state: stateAfter },
    });
  }
}

/**
 * Connects the business to Stripe: its account is made the first time
 * (named after the business, nothing else sent), then a one-time link to
 * Stripe's own onboarding is made for it.
 */
export async function startStripeOnboarding(
  deps: PaymentDependencies,
  actor: ActingUser,
  urls: OnboardingUrls,
): Promise<string> {
  const existing = await loadPaymentAccount(deps.database, actor.operatorId);
  if (existing) {
    return deps.payments.onboardingLink(existing.stripeAccountId, urls);
  }
  const business = await loadBusinessDetails(deps.database, actor.operatorId);
  const created = await deps.payments.createAccount({
    operatorId: actor.operatorId,
    businessName: business?.tradingName ?? business?.legalName ?? "",
    email: business?.email ?? null,
  });
  await withTenant(deps.database, actor.operatorId, async (tx) => {
    const [added] = await tx
      .insert(stripeAccounts)
      .values({
        operatorId: actor.operatorId,
        stripeAccountId: created.accountId,
        isLive: created.isLive,
      })
      .onConflictDoNothing()
      .returning({ operatorId: stripeAccounts.operatorId });
    if (added) {
      await recordActivity(tx, {
        operatorId: actor.operatorId,
        actor: { type: "user", id: actor.userId },
        entityType: ACTIVITY_ENTITY_TYPES.stripeAccount,
        entityId: actor.operatorId,
        action: ACTIVITY_ACTIONS.created,
        valuesAfter: { isLive: created.isLive },
      });
    }
  });
  return deps.payments.onboardingLink(created.accountId, urls);
}

/** Asks Stripe what the account can do now and keeps it; the browser's word is never taken. */
export async function refreshPaymentAccount(
  deps: PaymentDependencies,
  operatorId: string,
): Promise<PaymentAccountState> {
  const account = await loadPaymentAccount(deps.database, operatorId);
  if (!account) {
    return "not_connected";
  }
  const status = await deps.payments.accountStatus(account.stripeAccountId);
  await withTenant(deps.database, operatorId, (tx) =>
    saveStatus(tx, operatorId, status, deps.now()),
  );
  return paymentAccountState(status);
}

export type PaymentEventResult = "refused" | "ignored" | "repeat" | "handled";

const operatorRowSchema = z.object({
  rows: z.array(z.object({ operator_id: z.uuid().nullable() })),
});

/** The business whose account an event is about: from the account ID only (rule 3). */
async function operatorForAccount(
  database: AnyDatabase,
  accountId: string,
): Promise<string | null> {
  const result = operatorRowSchema.parse(
    await database.execute(
      sql`SELECT app.operator_for_stripe_account(${accountId}) AS operator_id`,
    ),
  );
  return result.rows[0]?.operator_id ?? null;
}

const ACCOUNT_EVENT = /^v2\.core\.account[.[]/;
/** A visit to Stripe's page finished, or its bank debit cleared or bounced later. */
const CHECKOUT_EVENTS: ReadonlySet<string> = new Set([
  "v1.checkout.session.completed",
  "v1.checkout.session.async_payment_succeeded",
  "v1.checkout.session.async_payment_failed",
]);
const MANDATE_EVENT = "v1.mandate.updated";
const recordedSchema = z.object({ rows: z.array(z.object({ is_new: z.boolean() })) });

/** What Stripe says now about the thing an event is about, read from Stripe, never from the event. */
type EventDetails =
  | { kind: "account"; status: PaymentAccountStatus }
  | { kind: "checkout"; outcome: CheckoutOutcome }
  | { kind: "mandate"; mandateId: string; stripeStatus: string }
  | { kind: "other" };

async function readEventDetails(
  payments: PaymentsProvider,
  notice: PaymentEventNotice,
  accountId: string,
): Promise<EventDetails> {
  if (ACCOUNT_EVENT.test(notice.type)) {
    return { kind: "account", status: await payments.accountStatus(accountId) };
  }
  if (CHECKOUT_EVENTS.has(notice.type) && notice.objectId) {
    return { kind: "checkout", outcome: await payments.readCheckout(accountId, notice.objectId) };
  }
  if (notice.type === MANDATE_EVENT && notice.objectId) {
    return {
      kind: "mandate",
      mandateId: notice.objectId,
      stripeStatus: await payments.readMandateStatus(accountId, notice.objectId),
    };
  }
  return { kind: "other" };
}

async function applyEventDetails(
  tx: AnyTransaction,
  operatorId: string,
  details: EventDetails,
  now: Date,
): Promise<void> {
  if (details.kind === "account") {
    await saveStatus(tx, operatorId, details.status, now);
  } else if (details.kind === "checkout") {
    await applyCheckoutOutcome(tx, operatorId, details.outcome, now);
  } else if (details.kind === "mandate") {
    await applyMandateStatus(tx, operatorId, details, now);
  }
}

/**
 * An event from Stripe: its signature proved, its business found from its
 * account, then handled once in that business's own tenant context (rules
 * 3 and 20). What it is about is read from Stripe itself: an account's
 * status, a visit to Stripe's page, or a direct debit.
 */
export async function handlePaymentEvent(
  deps: PaymentDependencies,
  payload: string,
  signature: string,
): Promise<PaymentEventResult> {
  const notice = await deps.payments.readEvent(payload, signature);
  if (!notice) {
    return "refused";
  }
  const operatorId =
    notice.accountId && isStripeAccountId(notice.accountId)
      ? await operatorForAccount(deps.database, notice.accountId)
      : null;
  if (!operatorId || !notice.accountId) {
    return "ignored";
  }
  // Asked before the transaction: Stripe is never waited on while rows are locked.
  const details = await readEventDetails(deps.payments, notice, notice.accountId);
  return withTenant(deps.database, operatorId, async (tx) => {
    const recorded = await tx.execute(
      sql`SELECT app.record_stripe_event(${notice.id}, ${notice.type}, ${operatorId}::uuid) AS is_new`,
    );
    const isNew = recordedSchema.parse(recorded).rows[0]?.is_new === true;
    if (!isNew) {
      return "repeat";
    }
    await applyEventDetails(tx, operatorId, details, deps.now());
    return "handled";
  });
}
