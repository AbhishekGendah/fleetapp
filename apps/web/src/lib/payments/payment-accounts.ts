import {
  describeErrorForLog,
  isStripeAccountId,
  MILLISECONDS_PER_DAY,
  paymentAccountState,
  storedAccountStatus,
  type PaymentAccountState,
  type PaymentAccountStatus,
  operatorDisplayName,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { recordActivity } from "@fleetapp/db/activity";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, stripeAccounts } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { ActingUser } from "../acting-user";
import { loadBusinessDetails } from "../settings/business-details";
import { detachReplacedMandates } from "./stripe-tidy-up";
import { applyMoneyTakenBack, bondPaymentOf } from "./stripe-money-back";
import type {
  CheckoutOutcome,
  MoneyTakenBack,
  OnboardingUrls,
  PaymentEventNotice,
  PaymentsProvider,
} from "./payments-provider";
import { applyCheckoutOutcome, applyMandateStatus, isMandateKnown } from "./renter-payment-records";
import { isBondPaymentAwaited } from "./stripe-checkouts";

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
  const status = storedAccountStatus(row);
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
  // Once disconnected, an account stays so: a different one is connected instead (review A5-5).
  const disconnectedAt = before.disconnectedAt ?? (status.isDisconnected ? now : null);
  await tx
    .update(stripeAccounts)
    .set({
      cardPayments: status.cardPayments,
      becsDebitPayments: status.becsDebitPayments,
      requirementsDue: status.requirementsDue,
      requirementsLater: status.requirementsLater,
      disconnectedAt,
      checkedAt: now,
      updatedAt: now,
    })
    .where(eq(stripeAccounts.operatorId, operatorId));
  const stateBefore = paymentAccountState(storedAccountStatus(before));
  const stateAfter = paymentAccountState(storedAccountStatus({ ...status, disconnectedAt }));
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
    businessName: operatorDisplayName(business),
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
  if (account.state === "disconnected") {
    // Stripe no longer lets us read it, and it stays disconnected (review A5-5).
    return account.state;
  }
  const status = await deps.payments.accountStatus(account.stripeAccountId);
  await withTenant(deps.database, operatorId, (tx) =>
    saveStatus(tx, operatorId, status, deps.now()),
  );
  return paymentAccountState(status);
}

/** "not_ready": about something not recorded yet, so it is left for Stripe to send again (review KS-7). */
export type PaymentEventResult = "refused" | "ignored" | "repeat" | "handled" | "not_ready";

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
/** A visit to Stripe's page finished or expired, or its bank debit cleared or bounced later. */
const CHECKOUT_EVENTS: ReadonlySet<string> = new Set([
  "v1.checkout.session.completed",
  "v1.checkout.session.expired",
  "v1.checkout.session.async_payment_succeeded",
  "v1.checkout.session.async_payment_failed",
]);
const MANDATE_EVENT = "v1.mandate.updated";
/** A refund the business made in Stripe was made, moved on or failed (review A5-4). */
const REFUND_EVENTS: ReadonlySet<string> = new Set([
  "v1.refund.created",
  "v1.refund.updated",
  "v1.refund.failed",
]);
/** The Renter's bank took disputed money back, or gave it back once the business won. */
const DISPUTE_EVENTS: Readonly<Record<string, "withdrawn" | "reinstated">> = {
  "v1.charge.dispute.funds_withdrawn": "withdrawn",
  "v1.charge.dispute.funds_reinstated": "reinstated",
};
/**
 * The business closed its Stripe account, or disconnected it from AGS's
 * platform (review A5-5). Stripe no longer lets us read it, so these are
 * acted on without asking Stripe.
 */
const DISCONNECT_EVENTS: ReadonlySet<string> = new Set([
  "v2.core.account.closed",
  "v1.account.application.deauthorized",
]);
const recordedSchema = z.object({ rows: z.array(z.object({ is_new: z.boolean() })) });

/** What Stripe says now about the thing an event is about, read from Stripe, never from the event. */
type EventDetails =
  | { kind: "account"; status: PaymentAccountStatus }
  | { kind: "checkout"; outcome: CheckoutOutcome }
  | { kind: "mandate"; mandateId: string; stripeStatus: string }
  | { kind: "disconnected" }
  | { kind: "taken_back"; takenBack: MoneyTakenBack }
  | { kind: "other" };

async function readEventDetails(
  payments: PaymentsProvider,
  notice: PaymentEventNotice,
  accountId: string,
): Promise<EventDetails> {
  if (DISCONNECT_EVENTS.has(notice.type)) {
    return { kind: "disconnected" };
  }
  if (ACCOUNT_EVENT.test(notice.type)) {
    return { kind: "account", status: await payments.accountStatus(accountId) };
  }
  if (CHECKOUT_EVENTS.has(notice.type) && notice.objectId) {
    return { kind: "checkout", outcome: await payments.readCheckout(accountId, notice.objectId) };
  }
  if (REFUND_EVENTS.has(notice.type) && notice.objectId) {
    return { kind: "taken_back", takenBack: await payments.readRefund(accountId, notice.objectId) };
  }
  const disputeMoney = DISPUTE_EVENTS[notice.type];
  if (disputeMoney && notice.objectId) {
    return {
      kind: "taken_back",
      takenBack: await payments.readDispute(accountId, notice.objectId, disputeMoney),
    };
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
  times: { now: Date; occurredAt: Date },
): Promise<void> {
  const { now } = times;
  if (details.kind === "account") {
    await saveStatus(tx, operatorId, details.status, now);
  } else if (details.kind === "checkout") {
    await applyCheckoutOutcome(tx, operatorId, details.outcome, now, times.occurredAt);
  } else if (details.kind === "mandate") {
    await applyMandateStatus(tx, operatorId, details, now);
  } else if (details.kind === "disconnected") {
    await markDisconnected(tx, operatorId, now);
  } else if (details.kind === "taken_back") {
    await applyMoneyTakenBack(tx, operatorId, details.takenBack, times.occurredAt);
  }
}

/** The account can no longer take payments: Renters stop being offered Stripe's page. */
async function markDisconnected(tx: AnyTransaction, operatorId: string, now: Date): Promise<void> {
  const [marked] = await tx
    .update(stripeAccounts)
    .set({ disconnectedAt: now, updatedAt: now })
    .where(and(eq(stripeAccounts.operatorId, operatorId), isNull(stripeAccounts.disconnectedAt)))
    .returning({ operatorId: stripeAccounts.operatorId });
  if (marked) {
    await recordActivity(tx, {
      operatorId,
      actor: SYSTEM_ACTOR,
      entityType: ACTIVITY_ENTITY_TYPES.stripeAccount,
      entityId: operatorId,
      action: ACTIVITY_ACTIONS.updated,
      valuesAfter: { state: "disconnected" },
    });
  }
}

/**
 * How long news about a direct debit or payment we haven't recorded yet is
 * sent back for Stripe to retry. Its own Checkout message comes within
 * minutes; one still unknown after this was never ours (say, a direct
 * debit the business made in its own Stripe dashboard), so it is left
 * alone rather than failing for days (deep review of batch 2).
 */
const NOT_READY_WINDOW_MS = 60 * 60 * 1000;

/** How long Stripe keeps sending an event that isn't answered with success (live mode). */
const STRIPE_RETRY_WINDOW_MS = 3 * MILLISECONDS_PER_DAY;

/**
 * Whether an event is about something of ours whose own record is still
 * on its way: "soon" within the hour, "late" for a refund or dispute still
 * waiting after it. A refund or dispute is never left while a bond payment
 * of the business could still be recorded (its Checkout message delayed or
 * failing), since taking it as handled would lose it for good.
 */
async function awaitedOwnRecord(
  tx: AnyTransaction,
  operatorId: string,
  details: EventDetails,
  notice: PaymentEventNotice,
  now: Date,
): Promise<"no" | "soon" | "late"> {
  const isWithinHour = now.getTime() - notice.occurredAt.getTime() <= NOT_READY_WINDOW_MS;
  if (details.kind === "mandate") {
    return isWithinHour && !(await isMandateKnown(tx, details.mandateId)) ? "soon" : "no";
  }
  const paymentIntentId = details.kind === "taken_back" ? details.takenBack.paymentIntentId : null;
  if (!paymentIntentId || (await bondPaymentOf(tx, operatorId, paymentIntentId))) {
    return "no";
  }
  if (isWithinHour) {
    return "soon";
  }
  return (await isBondPaymentAwaited(tx, operatorId, notice.occurredAt)) ? "late" : "no";
}

/**
 * A refund or dispute still waiting for its payment after the hour: told to
 * AGS by Stripe's ids only (rule 7). Once Stripe stops sending it, it is
 * resent from Stripe's dashboard after the payment is recorded.
 */
function alertTakenBackWaiting(
  operatorId: string,
  notice: PaymentEventNotice,
  details: EventDetails,
  now: Date,
): void {
  const hasStripeStopped = now.getTime() - notice.occurredAt.getTime() > STRIPE_RETRY_WINDOW_MS;
  console.error("A Stripe refund or dispute is waiting for its bond payment to be recorded", {
    operatorId,
    eventId: notice.id,
    objectId: details.kind === "taken_back" ? details.takenBack.objectId : null,
    paymentIntentId: details.kind === "taken_back" ? details.takenBack.paymentIntentId : null,
    hasStripeStopped,
  });
}

async function isDisconnected(deps: PaymentDependencies, operatorId: string): Promise<boolean> {
  return (await loadPaymentAccount(deps.database, operatorId))?.state === "disconnected";
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
  if (!DISCONNECT_EVENTS.has(notice.type) && (await isDisconnected(deps, operatorId))) {
    // Stripe no longer lets us read it: news about it is left, never retried for days.
    return "ignored";
  }
  // Asked before the transaction: Stripe is never waited on while rows are locked.
  const details = await readEventDetails(deps.payments, notice, notice.accountId);
  const result = await withTenant(deps.database, operatorId, async (tx) => {
    const awaited = await awaitedOwnRecord(tx, operatorId, details, notice, deps.now());
    if (awaited !== "no") {
      if (awaited === "late") {
        alertTakenBackWaiting(operatorId, notice, details, deps.now());
      }
      // Its Checkout message is still on its way: not marked handled, so Stripe sends this again.
      return "not_ready" as const;
    }
    const recorded = await tx.execute(
      sql`SELECT app.record_stripe_event(${notice.id}, ${notice.type}, ${operatorId}::uuid) AS is_new`,
    );
    const isNew = recordedSchema.parse(recorded).rows[0]?.is_new === true;
    if (!isNew) {
      return "repeat";
    }
    await applyEventDetails(tx, operatorId, details, {
      now: deps.now(),
      occurredAt: notice.occurredAt,
    });
    return "handled" as const;
  });
  if (result === "handled" && (details.kind === "checkout" || details.kind === "mandate")) {
    // A newer direct debit may have replaced one: cancel it at Stripe now, not only overnight.
    try {
      await detachReplacedMandates(deps, operatorId);
    } catch (error) {
      // The event is saved; the nightly tidy-up tries again.
      console.error("Detaching after a Stripe event failed", describeErrorForLog(error));
    }
  }
  return result;
}
