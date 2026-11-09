import type { CheckoutPurpose } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { payments, stripeCheckouts } from "@fleetapp/db/schema";
import { and, eq, gt, lte, notExists, or, sql, sum, type SQL } from "drizzle-orm";

import type { CheckoutOutcome } from "./payments-provider";

/** A Stripe page we opened that may still be paid. */
export interface OpenCheckout {
  sessionId: string;
  url: string;
  amountCents: number | null;
  expiresAt: Date;
}

const OPEN_CHECKOUT_COLUMNS = {
  sessionId: stripeCheckouts.stripeCheckoutSessionId,
  url: stripeCheckouts.url,
  amountCents: stripeCheckouts.amountCents,
  expiresAt: stripeCheckouts.expiresAt,
} as const;

/**
 * The rental's open bond page, if any. Two presses at once may both find
 * none: the one-open-page index then keeps one of the pages they open, and
 * the other is expired at Stripe (saveCheckout, review KS-1).
 */
export async function findOpenBondCheckout(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<OpenCheckout | null> {
  const [open] = await tx
    .select(OPEN_CHECKOUT_COLUMNS)
    .from(stripeCheckouts)
    .where(
      and(
        eq(stripeCheckouts.operatorId, operatorId),
        eq(stripeCheckouts.rentalId, rentalId),
        eq(stripeCheckouts.purpose, "bond"),
        eq(stripeCheckouts.status, "open"),
      ),
    );
  return open ?? null;
}

/** The pages a link opened that are still open: what to ask Stripe about when the Renter comes back. */
export function openCheckoutsOfLink(
  tx: AnyTransaction,
  operatorId: string,
  linkId: string,
  now: Date,
): Promise<OpenCheckout[]> {
  return tx
    .select(OPEN_CHECKOUT_COLUMNS)
    .from(stripeCheckouts)
    .where(
      and(
        eq(stripeCheckouts.operatorId, operatorId),
        eq(stripeCheckouts.linkId, linkId),
        eq(stripeCheckouts.status, "open"),
        // One past its time can't have been paid since; it is settled when Stripe says so.
        gt(stripeCheckouts.expiresAt, now),
      ),
    );
}

/** A page just opened at Stripe, kept; false if another bond page won the race to be the open one. */
export async function saveCheckout(
  tx: AnyTransaction,
  page: {
    operatorId: string;
    rentalId: string;
    linkId: string;
    purpose: CheckoutPurpose;
    amountCents: number | null;
    sessionId: string;
    url: string;
    expiresAt: Date;
    now: Date;
  },
): Promise<boolean> {
  const saved = await tx
    .insert(stripeCheckouts)
    .values({
      operatorId: page.operatorId,
      rentalId: page.rentalId,
      linkId: page.linkId,
      purpose: page.purpose,
      amountCents: page.amountCents,
      stripeCheckoutSessionId: page.sessionId,
      url: page.url,
      expiresAt: page.expiresAt,
      createdAt: page.now,
      updatedAt: page.now,
    })
    .onConflictDoNothing({
      target: [stripeCheckouts.operatorId, stripeCheckouts.rentalId],
      // The partial unique index stripe_checkouts_one_open_bond.
      where: sql`${stripeCheckouts.status} = 'open' and ${stripeCheckouts.purpose} = 'bond'`,
    })
    .returning({ id: stripeCheckouts.id });
  return saved.length > 0;
}

/** Marks a page we opened finished or expired, as Stripe says it now is. */
export async function settleCheckout(
  tx: AnyTransaction,
  operatorId: string,
  outcome: Pick<CheckoutOutcome, "sessionId" | "isComplete" | "isExpired">,
  now: Date,
): Promise<void> {
  if (!outcome.isComplete && !outcome.isExpired) {
    return;
  }
  await tx
    .update(stripeCheckouts)
    .set({ status: outcome.isComplete ? "complete" : "expired", updatedAt: now })
    .where(
      and(
        eq(stripeCheckouts.operatorId, operatorId),
        eq(stripeCheckouts.stripeCheckoutSessionId, outcome.sessionId),
        eq(stripeCheckouts.status, "open"),
      ),
    );
}

/**
 * Bond on finished Stripe pages we have no payment for yet: counted as on
 * its way, never as still to pay (review KS-1).
 */
export async function unrecordedBondCents(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<number> {
  const [row] = await tx
    .select({ cents: sum(stripeCheckouts.amountCents).mapWith(Number) })
    .from(stripeCheckouts)
    .where(
      and(
        eq(stripeCheckouts.operatorId, operatorId),
        eq(stripeCheckouts.rentalId, rentalId),
        eq(stripeCheckouts.purpose, "bond"),
        eq(stripeCheckouts.status, "complete"),
        hasNoPaymentRecorded(tx, operatorId),
      ),
    );
  return row?.cents ?? 0;
}

/**
 * Whether a bond payment of this business may still be on its way to us: a
 * bond page finished with no payment recorded yet, or one still open that
 * was opened before `openedBefore` (so it may have been paid by then). A
 * refund or dispute about a payment we don't know yet waits for it while
 * this holds; otherwise the payment was never ours.
 */
export async function isBondPaymentAwaited(
  tx: AnyTransaction,
  operatorId: string,
  openedBefore: Date,
): Promise<boolean> {
  const [awaited] = await tx
    .select({ id: stripeCheckouts.id })
    .from(stripeCheckouts)
    .where(
      and(
        eq(stripeCheckouts.operatorId, operatorId),
        eq(stripeCheckouts.purpose, "bond"),
        or(
          eq(stripeCheckouts.status, "complete"),
          and(eq(stripeCheckouts.status, "open"), lte(stripeCheckouts.createdAt, openedBefore)),
        ),
        hasNoPaymentRecorded(tx, operatorId),
      ),
    )
    .limit(1);
  return awaited !== undefined;
}

/** A page's payment isn't recorded yet (no payment row for its session). */
function hasNoPaymentRecorded(tx: AnyTransaction, operatorId: string): SQL {
  return notExists(
    tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.operatorId, operatorId),
          eq(payments.stripeCheckoutSessionId, stripeCheckouts.stripeCheckoutSessionId),
        ),
      ),
  );
}
