import { canTakeStripePayments, type CheckoutPurpose } from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  rentals,
  renterStripeCustomers,
  renters,
  vehicles,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";

import { BOND_OPEN_STATUSES } from "../bonds/bond-account";
import { STRIPE_RETURN_PATH } from "../paths";
import type { LinkVisit } from "../renter-links/link-visits";
import { loadPaymentAccount } from "./payment-accounts";
import type { PaymentsProvider } from "./payments-provider";
import { rentalPaymentsIn, type RentalPayments } from "./renter-payment-records";

/** What the Renter's payment steps need: the database, Stripe (if set up here) and this site's address. */
export interface RenterCheckoutDependencies {
  database: AnyDatabase;
  /** Null while payments by Stripe are not set up on this site. */
  payments: PaymentsProvider | null;
  /** Whether we hear back about a business's own account: without it, Stripe's page is not offered. */
  canHearRenterPayments: boolean;
  /** The Operator app's address (APP_URL), for Stripe's way back. */
  appUrl: string;
  now: () => Date;
}

/** How Stripe's page sends the Renter back: finished, or left without finishing. */
export const STRIPE_RETURN_STEPS = { finished: "finished", left: "left" } as const;

/**
 * Whether this business's Renters can be sent to Stripe's page: payments
 * by Stripe set up on this site and heard back from, and the business's
 * own Stripe account ready (cards and direct debit on).
 */
export async function isStripeOfferedToRenters(
  deps: RenterCheckoutDependencies,
  operatorId: string,
): Promise<{ accountId: string; payments: PaymentsProvider } | null> {
  if (!deps.payments || !deps.canHearRenterPayments) {
    return null;
  }
  const account = await loadPaymentAccount(deps.database, operatorId);
  return account && canTakeStripePayments(account.state)
    ? { accountId: account.stripeAccountId, payments: deps.payments }
    : null;
}

/**
 * The rental payments are for, with its Renter: only this business's, only
 * the link's own Renter when a link asks, and only while the rental is open.
 */
/** A rental payments can be taken for, with its Renter's name and email and the car's rego. */
export interface PaymentsRental {
  id: string;
  status: string;
  bondCents: number;
  renterId: string;
  renterName: string;
  renterEmail: string | null;
  carRego: string;
}

export async function findPaymentsRental(
  tx: AnyTransaction,
  target: { operatorId: string; rentalId: string | null; renterId: string | null },
): Promise<PaymentsRental | null> {
  if (!target.rentalId) {
    return null;
  }
  const [rental] = await tx
    .select({
      id: rentals.id,
      status: rentals.status,
      bondCents: rentals.bondCents,
      renterId: rentals.renterId,
      renterName: renters.fullName,
      renterEmail: renters.email,
      carRego: vehicles.rego,
    })
    .from(rentals)
    .innerJoin(renters, eq(renters.id, rentals.renterId))
    .innerJoin(vehicles, eq(vehicles.id, rentals.vehicleId))
    .where(
      and(
        eq(rentals.id, target.rentalId),
        eq(rentals.operatorId, target.operatorId),
        target.renterId ? eq(rentals.renterId, target.renterId) : undefined,
      ),
    );
  return rental && BOND_OPEN_STATUSES.has(rental.status) ? rental : null;
}

/** The rental's payments as the Renter's page shows them, or null if the rental is not open. */
export async function loadPaymentsStep(
  database: AnyDatabase,
  visit: LinkVisit,
): Promise<RentalPayments | null> {
  return withTenant(database, visit.operatorId, async (tx) => {
    const rental = await findPaymentsRental(tx, visit);
    return rental ? rentalPaymentsIn(tx, visit.operatorId, rental) : null;
  });
}

/** The Renter's customer on the business's Stripe account: made once, then reused. */
async function customerFor(
  deps: RenterCheckoutDependencies,
  stripe: { accountId: string; payments: PaymentsProvider },
  visit: LinkVisit,
  renter: { name: string; email: string | null },
): Promise<string> {
  const [existing] = await withTenant(deps.database, visit.operatorId, (tx) =>
    tx
      .select({ id: renterStripeCustomers.stripeCustomerId })
      .from(renterStripeCustomers)
      .where(eq(renterStripeCustomers.renterId, visit.renterId)),
  );
  if (existing) {
    return existing.id;
  }
  const customerId = await stripe.payments.createCustomer(stripe.accountId, {
    renterId: visit.renterId,
    name: renter.name,
    email: renter.email,
  });
  await withTenant(deps.database, visit.operatorId, (tx) =>
    tx
      .insert(renterStripeCustomers)
      .values({
        operatorId: visit.operatorId,
        renterId: visit.renterId,
        stripeCustomerId: customerId,
      })
      .onConflictDoNothing(),
  );
  return customerId;
}

export type StartCheckoutResult =
  { status: "started"; url: string } | { status: "not_offered" | "not_found" | "nothing_owing" };

/**
 * Sends the Renter to Stripe's own page, on the business's account: to set
 * up their direct debit (accepting Stripe's Direct Debit Request there), or
 * to pay the bond still owing. We never see what they type (rule 7).
 */
export async function startRenterCheckout(
  deps: RenterCheckoutDependencies,
  visit: LinkVisit,
  purpose: CheckoutPurpose,
): Promise<StartCheckoutResult> {
  if (visit.purpose !== "set_up_payments") {
    return { status: "not_found" };
  }
  const stripe = await isStripeOfferedToRenters(deps, visit.operatorId);
  if (!stripe) {
    return { status: "not_offered" };
  }
  const found = await withTenant(deps.database, visit.operatorId, async (tx) => {
    const rental = await findPaymentsRental(tx, visit);
    return rental
      ? { rental, payments: await rentalPaymentsIn(tx, visit.operatorId, rental) }
      : null;
  });
  if (!found) {
    return { status: "not_found" };
  }
  const bondCents = found.payments.bond.toCollectCents;
  if (purpose === "bond" && bondCents === 0) {
    return { status: "nothing_owing" };
  }
  const customerId = await customerFor(deps, stripe, visit, {
    name: found.rental.renterName,
    email: found.rental.renterEmail,
  });
  const backTo = (step: string) => {
    const url = new URL(STRIPE_RETURN_PATH, deps.appUrl);
    url.searchParams.set("step", step);
    return url.toString();
  };
  const { url } = await stripe.payments.startCheckout(stripe.accountId, {
    customerId,
    reference: {
      purpose,
      rentalId: found.rental.id,
      renterId: visit.renterId,
      linkId: visit.linkId,
    },
    successUrl: backTo(STRIPE_RETURN_STEPS.finished),
    cancelUrl: backTo(STRIPE_RETURN_STEPS.left),
    payment:
      purpose === "bond"
        ? { amountCents: bondCents, description: `Bond for ${found.rental.carRego}` }
        : null,
  });
  await withTenant(deps.database, visit.operatorId, (tx) =>
    recordActivity(tx, {
      operatorId: visit.operatorId,
      actor: { type: "renter_link", id: visit.linkId },
      entityType: ACTIVITY_ENTITY_TYPES.rental,
      entityId: found.rental.id,
      action: ACTIVITY_ACTIONS.checkoutStarted,
      valuesAfter: { purpose, ...(purpose === "bond" ? { amountCents: bondCents } : {}) },
    }),
  );
  return { status: "started", url };
}
