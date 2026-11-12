import {
  DEBIT_LOOKUP_CLOCK_MARGIN_MS,
  DEBIT_REREAD_AFTER_MS,
  debitRecoveryStep,
  describeErrorForLog,
  todayInTimeZone,
} from "@fleetapp/core";
import {
  debitItems,
  debitPlans,
  ledgerLines,
  operators,
  payments,
  rentals,
} from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";

import { lockPaymentRental } from "../bonds/bond-records";
import { findDueOperators, forEachOperator, type OperatorRun } from "../jobs/due-operators";
import { loadPaymentAccount, type PaymentDependencies } from "../payments/payment-accounts";
import type { DebitRead } from "../payments/payments-provider";
import { applyDebitRead, failReservedDebit, NOT_SENT } from "./debit-outcome";
import { IS_DEBIT, stripeCustomerOf } from "./debit-queries";
import { reserveNoticedOwnDebits, reserveWeeklyDebit, type ReservedDebit } from "./debit-reserve";
import { sendReservedDebit } from "./debit-send";

/** A debit of ours still pending, as recovery and the re-read look at it. */
interface PendingDebit extends ReservedDebit {
  renterId: string;
  requestedAt: Date;
  stripePaymentIntentId: string | null;
}

/** The business's debits still pending: reserved with no answer saved, or sent and not yet settled. */
async function pendingDebits(
  deps: PaymentDependencies,
  operatorId: string,
): Promise<PendingDebit[]> {
  const rows = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({
        id: payments.id,
        rentalId: payments.rentalId,
        renterId: payments.renterId,
        requestedAt: payments.requestedAt,
        stripePaymentIntentId: payments.stripePaymentIntentId,
      })
      .from(payments)
      .where(
        and(
          eq(payments.operatorId, operatorId),
          IS_DEBIT,
          eq(payments.status, "pending"),
          isNotNull(payments.requestedAt),
        ),
      ),
  );
  return rows.flatMap((row) => (row.requestedAt ? [{ ...row, requestedAt: row.requestedAt }] : []));
}

/**
 * A reserved debit whose answer was never saved (a crash, a timeout), once
 * over 15 minutes old so it never races a request still under way: within
 * 23 hours asked again with the same key (Stripe gives back its first
 * answer), but only while it could still be made now (the rental not
 * paused, the business not suspended, its Stripe account ready). Otherwise,
 * or after that, looked up among the Renter's Stripe debits since it was
 * reserved, by our ID in the metadata, and if none is found marked "not
 * sent" and never sent again (never sent blind once the key may be gone).
 */
async function recoverReserved(
  deps: PaymentDependencies,
  operatorId: string,
  accountId: string,
  debit: PendingDebit,
): Promise<void> {
  const step = debitRecoveryStep(debit.requestedAt, deps.now());
  if (step === "wait") {
    return;
  }
  if (step === "ask_again" && (await canStillBeMade(deps, operatorId, debit.rentalId))) {
    await sendReservedDebit(deps, operatorId, debit);
    return;
  }
  const customerId = await withTenant(deps.database, operatorId, (tx) =>
    stripeCustomerOf(tx, operatorId, debit.renterId),
  );
  const found = customerId
    ? await deps.payments.findDebitByReference(accountId, {
        customerId,
        paymentId: debit.id,
        createdSince: new Date(debit.requestedAt.getTime() - DEBIT_LOOKUP_CLOCK_MARGIN_MS),
      })
    : null;
  await applyRead(deps, operatorId, debit, found);
}

/** Whether a debit could still be asked for now: its business can debit and its rental isn't paused. */
async function canStillBeMade(
  deps: PaymentDependencies,
  operatorId: string,
  rentalId: string,
): Promise<boolean> {
  const [rental] = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({ pausedAt: rentals.debitsPausedAt })
      .from(rentals)
      .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId))),
  );
  return rental !== undefined && rental.pausedAt === null && (await canDebitNow(deps, operatorId));
}

/** Stripe's read applied as its event would be, or the debit marked not sent when there is none. */
async function applyRead(
  deps: PaymentDependencies,
  operatorId: string,
  debit: PendingDebit,
  read: DebitRead | null,
): Promise<void> {
  const now = deps.now();
  const rentalWithLine = await withTenant(deps.database, operatorId, async (tx) => {
    if (!read) {
      await failReservedDebit(tx, operatorId, debit, NOT_SENT, now);
      return null;
    }
    return applyDebitRead(tx, operatorId, read, { now, occurredAt: now });
  });
  if (rentalWithLine) {
    await deps.afterLedgerLines?.(operatorId, rentalWithLine);
  }
}

/**
 * Finishes what earlier runs left: recovers reserved debits with no answer
 * saved, and reads again from Stripe any debit pending over 7 days in case
 * its message was lost (applied through the same code as the message, so a
 * cleared debit is never put on the ledger twice).
 */
async function finishEarlierDebits(
  deps: PaymentDependencies,
  operatorId: string,
  accountId: string,
): Promise<void> {
  const rereadBefore = deps.now().getTime() - DEBIT_REREAD_AFTER_MS;
  for (const debit of await pendingDebits(deps, operatorId)) {
    if (!debit.stripePaymentIntentId) {
      await recoverReserved(deps, operatorId, accountId, debit);
    } else if (debit.requestedAt.getTime() <= rereadBefore) {
      await applyRead(
        deps,
        operatorId,
        debit,
        await deps.payments.readDebit(accountId, debit.stripePaymentIntentId),
      );
    }
  }
}

/**
 * The business's own day, when new debits can be made: not suspended
 * (decision 4), its Stripe account ready. Null when they can't.
 */
async function debitDayNow(deps: PaymentDependencies, operatorId: string): Promise<string | null> {
  const [operator] = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({ suspendedAt: operators.suspendedAt, timezone: operators.timezone })
      .from(operators)
      .where(eq(operators.id, operatorId)),
  );
  const account = await loadPaymentAccount(deps.database, operatorId);
  const canDebit =
    operator !== undefined && operator.suspendedAt === null && account?.state === "ready";
  return canDebit ? todayInTimeZone(deps.now(), operator.timezone) : null;
}

/** Whether new debits can be made: not suspended (decision 4), its Stripe account ready. */
async function canDebitNow(deps: PaymentDependencies, operatorId: string): Promise<boolean> {
  return (await debitDayNow(deps, operatorId)) !== null;
}

/** The rentals a one-off charge can still be debited on (as "Debit on [date]" allows). */
const OWN_DEBIT_STATUSES = ["booked", "active", "returned"] as const;

/**
 * The business's rentals to look at tonight, automatic debits not paused:
 * its long-term rentals out (the week's debit), and any rental with a
 * "Debit on [date]" charge whose day has come by `today`.
 */
async function rentalsToDebit(
  deps: PaymentDependencies,
  operatorId: string,
  today: string,
): Promise<string[]> {
  const rows = await withTenant(deps.database, operatorId, async (tx) => [
    ...(await tx
      .select({ id: rentals.id })
      .from(rentals)
      .where(
        and(
          eq(rentals.operatorId, operatorId),
          eq(rentals.status, "active"),
          eq(rentals.rentModel, "blocks"),
          eq(rentals.isLongTerm, true),
          isNull(rentals.debitsPausedAt),
        ),
      )),
    ...(await tx
      .selectDistinct({ id: rentals.id })
      .from(debitPlans)
      .innerJoin(
        rentals,
        and(eq(rentals.id, debitPlans.rentalId), eq(rentals.operatorId, debitPlans.operatorId)),
      )
      .where(
        and(
          eq(debitPlans.operatorId, operatorId),
          eq(debitPlans.plan, "own_debit"),
          lte(debitPlans.noticeDate, today),
          inArray(rentals.status, [...OWN_DEBIT_STATUSES]),
          isNull(rentals.debitsPausedAt),
          sql`not exists (select 1 from ${debitItems}
            where ${qualified(debitItems.ledgerLineId)} = ${qualified(debitPlans.ledgerLineId)})`,
          sql`not exists (select 1 from ${ledgerLines} reversal
            where reversal.reverses_id = ${qualified(debitPlans.ledgerLineId)})`,
        ),
      )),
  ]);
  return [...new Set(rows.map((row) => row.id))];
}

/**
 * One rental's debits for the night, reserved in its own short transaction
 * with the rental locked first (then sent, each after it): the week's
 * debit, and each "Debit on [date]" charge whose day has come.
 */
async function debitRental(
  deps: PaymentDependencies,
  operatorId: string,
  rentalId: string,
  today: string,
): Promise<number> {
  const clock = { now: deps.now(), today };
  const reserved = await withTenant(deps.database, operatorId, async (tx) => {
    const rental = await lockPaymentRental(tx, operatorId, rentalId);
    const [paused] = rental
      ? await tx
          .select({ at: rentals.debitsPausedAt })
          .from(rentals)
          .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)))
      : [];
    if (!rental || paused?.at) {
      return [];
    }
    const weekly = await reserveWeeklyDebit(tx, operatorId, rentalId, clock);
    const own = await reserveNoticedOwnDebits(tx, operatorId, rental, clock);
    return weekly ? [weekly, ...own] : own;
  });
  for (const debit of reserved) {
    await sendReservedDebit(deps, operatorId, debit);
  }
  return reserved.length;
}

/**
 * One business's debits for the night (docs/plans/phase-4-slice-5.md):
 * what earlier runs left finished first, then each rental's debits, one
 * rental at a time so one failure never stops the rest. Safe to run
 * again: nothing is debited twice (rule 20). Gives back the debits asked for.
 */
export async function debitsForOperator(
  deps: PaymentDependencies,
  operatorId: string,
): Promise<number> {
  const account = await loadPaymentAccount(deps.database, operatorId);
  if (!account || account.state === "disconnected") {
    return 0;
  }
  await finishEarlierDebits(deps, operatorId, account.stripeAccountId);
  const today = await debitDayNow(deps, operatorId);
  if (!today) {
    return 0;
  }
  let asked = 0;
  let failed = 0;
  for (const rentalId of await rentalsToDebit(deps, operatorId, today)) {
    try {
      asked += await debitRental(deps, operatorId, rentalId, today);
    } catch (error) {
      failed += 1;
      console.error("One rental's debits failed", {
        operatorId,
        rentalId,
        ...describeErrorForLog(error),
      });
    }
  }
  if (failed > 0) {
    throw new Error(`${failed} rentals could not be debited`);
  }
  return asked;
}

/**
 * The nightly debit run: asks which businesses have debits to do (the one
 * place IDs cross businesses, rule 3), then works each in its own tenant
 * context. One business failing never stops the others.
 */
export async function runDebitJob(
  deps: PaymentDependencies,
  isOutOfTime: () => boolean = () => false,
): Promise<OperatorRun> {
  const operatorIds = await findDueOperators(
    deps.database,
    sql`SELECT operator_id FROM app.operators_with_debits_due() AS operator_id`,
  );
  return forEachOperator(
    operatorIds,
    "Weekly debits",
    (operatorId) => debitsForOperator(deps, operatorId),
    isOutOfTime,
  );
}
