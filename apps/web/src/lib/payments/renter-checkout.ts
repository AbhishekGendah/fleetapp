import {
  areRenterPaymentsOffered,
  bondPayableOnlineCents,
  CHECKOUT_LIFETIME_MS,
  describeErrorForLog,
  type CheckoutPurpose,
} from "@fleetapp/core";
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
import { and, eq, sql, isNull } from "drizzle-orm";

import { BOND_OPEN_STATUSES } from "../bonds/bond-account";
import { lockBondRental } from "../bonds/bond-records";
import { STRIPE_RETURN_PATH } from "../paths";
import { isWithinLinkLimit } from "../renter-links/link-limits";
import type { LinkVisit } from "../renter-links/link-visits";
import { loadPaymentAccount } from "./payment-accounts";
import type { CheckoutOutcome, PaymentsProvider } from "./payments-provider";
import {
  applyCheckoutOutcome,
  rentalPaymentsIn,
  type RentalPayments,
} from "./renter-payment-records";
import { findOpenBondCheckout, openCheckoutsOfLink, saveCheckout } from "./stripe-checkouts";
import { tellStripeAboutRenter } from "./stripe-tidy-up";

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
  if (!deps.payments) {
    return null;
  }
  const account = await loadPaymentAccount(deps.database, operatorId);
  const isOffered =
    account !== null &&
    areRenterPaymentsOffered({
      isSiteSetUp: true,
      canHearRenterPayments: deps.canHearRenterPayments,
      state: account.state,
    });
  return isOffered ? { accountId: account.stripeAccountId, payments: deps.payments } : null;
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
  /** The Renter's full name, or a business's legal name: who Stripe's customer is. */
  renterName: string;
  /** Who the payments email greets: a business's contact (the email is theirs), else the Renter. */
  greetingName: string;
  renterEmail: string | null;
  carRego: string;
  carMakeModel: string;
  plannedStart: Date;
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
      greetingName: sql<string>`coalesce(${renters.contactName}, ${renters.fullName})`,
      renterEmail: renters.email,
      carRego: vehicles.rego,
      carMakeModel: sql<string>`${vehicles.make} || ' ' || ${vehicles.model}`,
      plannedStart: rentals.plannedStart,
    })
    .from(rentals)
    .innerJoin(renters, eq(renters.id, rentals.renterId))
    .innerJoin(vehicles, eq(vehicles.id, rentals.vehicleId))
    .where(
      and(
        eq(rentals.id, target.rentalId),
        eq(rentals.operatorId, target.operatorId),
        target.renterId ? eq(rentals.renterId, target.renterId) : undefined,
        // An archived Renter's links are stopped: no new one, and none opens (review A3-13).
        isNull(renters.archivedAt),
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
    // Stripe's copy of a name or email changed since is brought up to date first (review A5-6).
    await tellStripeAboutRenter(
      { database: deps.database, payments: stripe.payments, now: deps.now },
      visit.operatorId,
      visit.renterId,
    );
    return existing.id;
  }
  const customerId = await stripe.payments.createCustomer(stripe.accountId, {
    renterId: visit.renterId,
    name: renter.name,
    email: renter.email,
  });
  await withTenant(deps.database, visit.operatorId, async (tx) => {
    const [added] = await tx
      .insert(renterStripeCustomers)
      .values({
        operatorId: visit.operatorId,
        renterId: visit.renterId,
        stripeCustomerId: customerId,
      })
      .onConflictDoNothing()
      .returning({ id: renterStripeCustomers.id });
    if (added) {
      // Stripe's ID only: the name and email it was given stay with the Renter's record (rule 7).
      await recordActivity(tx, {
        operatorId: visit.operatorId,
        actor: { type: "renter_link", id: visit.linkId },
        entityType: ACTIVITY_ENTITY_TYPES.stripeCustomer,
        entityId: added.id,
        action: ACTIVITY_ACTIONS.created,
        valuesAfter: { renterId: visit.renterId },
      });
    }
  });
  return customerId;
}

export type StartCheckoutResult =
  | { status: "started"; url: string }
  | {
      status:
        | "not_offered"
        | "not_found"
        | "nothing_owing"
        | "just_paid"
        | "too_many"
        /** Recorded as received (by hand) while Stripe's page was being opened: none handed out. */
        | "bond_received"
        /** Part of it recorded meanwhile, so the page opened was for the wrong amount. */
        | "bond_changed";
    };

/** A bond page this close to expiring isn't handed out again: a fresh one is opened instead. */
const REUSE_MARGIN_MS = 5 * 60 * 1000;

type StripeAccess = { accountId: string; payments: PaymentsProvider };

/**
 * Asks Stripe about a page we opened and records what came of it, in the
 * business's own transaction: a payment made, a direct debit set up, or
 * the page expired.
 */
async function recordOutcome(
  deps: RenterCheckoutDependencies,
  stripe: StripeAccess,
  operatorId: string,
  sessionId: string,
): Promise<CheckoutOutcome> {
  const outcome = await stripe.payments.readCheckout(stripe.accountId, sessionId);
  await withTenant(deps.database, operatorId, (tx) =>
    applyCheckoutOutcome(tx, operatorId, outcome, deps.now()),
  );
  return outcome;
}

/**
 * Stops the rental's open bond page being paid: expired at Stripe, and if
 * the Renter had just paid it, that is recorded instead. Used before a new
 * page for a different amount, and once bond is recorded by hand, so a
 * Renter can't pay the bond on Stripe's page as well as at the counter
 * (deep review of batch 2). Stripe is asked outside any transaction.
 */
export async function retireOpenBondPage(
  deps: RenterCheckoutDependencies,
  stripe: StripeAccess,
  operatorId: string,
  rentalId: string,
): Promise<"none" | "expired" | "just_paid"> {
  const open = await withTenant(deps.database, operatorId, (tx) =>
    findOpenBondCheckout(tx, operatorId, rentalId),
  );
  return open ? retireBondPage(deps, stripe, operatorId, open.sessionId) : "none";
}

/** Expires one bond page at Stripe and records what came of it: "just_paid" if it was paid first. */
async function retireBondPage(
  deps: RenterCheckoutDependencies,
  stripe: StripeAccess,
  operatorId: string,
  sessionId: string,
): Promise<"expired" | "just_paid"> {
  await stripe.payments.expireCheckout(stripe.accountId, sessionId);
  const outcome = await recordOutcome(deps, stripe, operatorId, sessionId);
  return outcome.isComplete ? "just_paid" : "expired";
}

/**
 * Once bond is recorded by hand: the Stripe bond page that was open then
 * (`openBondPageId`, read under the rental's lock) is stopped, so it can't
 * be paid as well. Gives "just_paid" if the Renter had paid it meanwhile
 * (the business then holds the bond twice), even when Stripe's news of it
 * was recorded first. A failure is logged; the page expires by itself
 * within the hour.
 */
export async function stopBondPageAfterHandEntry(
  deps: RenterCheckoutDependencies,
  operatorId: string,
  openBondPageId: string | null,
): Promise<"none" | "expired" | "just_paid"> {
  if (!openBondPageId) {
    return "none";
  }
  const account = await loadPaymentAccount(deps.database, operatorId);
  if (!deps.payments || !account || account.state === "disconnected") {
    return "none";
  }
  try {
    return await retireBondPage(
      deps,
      { accountId: account.stripeAccountId, payments: deps.payments },
      operatorId,
      openBondPageId,
    );
  } catch (error) {
    console.error("Stopping a Stripe bond page failed", describeErrorForLog(error));
    return "none";
  }
}

/** The rental's open bond page if it can be handed out again: open, fresh, and for the same amount. */
async function reusableBondPage(
  deps: RenterCheckoutDependencies,
  operatorId: string,
  rental: { id: string; payableCents: number },
): Promise<string | null> {
  const open = await withTenant(deps.database, operatorId, (tx) =>
    findOpenBondCheckout(tx, operatorId, rental.id),
  );
  const isFresh =
    open !== null && open.expiresAt.getTime() - deps.now().getTime() > REUSE_MARGIN_MS;
  return isFresh && open.amountCents === rental.payableCents ? open.url : null;
}

/** Where Stripe's page sends the Renter back to: a page holding no secret (APP_URL). */
function backUrl(appUrl: string, step: string): string {
  const url = new URL(STRIPE_RETURN_PATH, appUrl);
  url.searchParams.set("step", step);
  return url.toString();
}

/** What keeping a page just opened at Stripe came to: handed out, or why not. */
type KeptPage =
  | { status: "kept" }
  | { status: "other_page"; url: string }
  | { status: "not_found" | "bond_received" | "bond_changed" };

/**
 * A bond page is kept only while that bond is still owing, checked under
 * the rental's lock (`lockBondRental`, as bond by hand takes): cash
 * recorded while Stripe opened the page would otherwise leave a page no
 * hand entry knew to stop, and the Renter could pay the bond twice.
 */
async function bondStillOwing(
  tx: AnyTransaction,
  operatorId: string,
  page: { rentalId: string; amountCents: number | null },
): Promise<KeptPage | null> {
  const rental = await lockBondRental(tx, operatorId, page.rentalId);
  if (!rental || !BOND_OPEN_STATUSES.has(rental.status)) {
    return { status: "not_found" };
  }
  const { bond } = await rentalPaymentsIn(tx, operatorId, rental);
  const payableCents = bondPayableOnlineCents(bond.toCollectCents);
  if (payableCents === 0) {
    return { status: "bond_received" };
  }
  return payableCents === page.amountCents ? null : { status: "bond_changed" };
}

/** Keeps a page just opened at Stripe, unless the bond was received meanwhile or another page won. */
async function keepNewPage(
  deps: RenterCheckoutDependencies,
  visit: LinkVisit,
  page: { rentalId: string; purpose: CheckoutPurpose; amountCents: number | null },
  opened: { sessionId: string; url: string; expiresAt: Date },
): Promise<KeptPage> {
  return withTenant(deps.database, visit.operatorId, async (tx) => {
    const refused =
      page.purpose === "bond" ? await bondStillOwing(tx, visit.operatorId, page) : null;
    if (refused) {
      return refused;
    }
    const isSaved = await saveCheckout(tx, {
      operatorId: visit.operatorId,
      linkId: visit.linkId,
      ...page,
      ...opened,
      now: deps.now(),
    });
    const winner = isSaved ? null : await findOpenBondCheckout(tx, visit.operatorId, page.rentalId);
    return winner ? { status: "other_page", url: winner.url } : { status: "kept" };
  });
}

/**
 * Opens a new Stripe page and keeps it. If another press opened the
 * rental's bond page in the meantime, the new one is expired at Stripe and
 * the other handed out, so only one can ever be paid; the same if the bond
 * was received while Stripe opened it, and nothing is handed out.
 */
async function openNewPage(
  deps: RenterCheckoutDependencies,
  stripe: StripeAccess,
  visit: LinkVisit,
  page: { rental: PaymentsRental; purpose: CheckoutPurpose; amountCents: number | null },
): Promise<StartCheckoutResult> {
  const customerId = await customerFor(deps, stripe, visit, {
    name: page.rental.renterName,
    email: page.rental.renterEmail,
  });
  const expiresAt = new Date(deps.now().getTime() + CHECKOUT_LIFETIME_MS);
  const opened = await stripe.payments.startCheckout(stripe.accountId, {
    customerId,
    reference: {
      purpose: page.purpose,
      rentalId: page.rental.id,
      renterId: visit.renterId,
      linkId: visit.linkId,
    },
    successUrl: backUrl(deps.appUrl, STRIPE_RETURN_STEPS.finished),
    cancelUrl: backUrl(deps.appUrl, STRIPE_RETURN_STEPS.left),
    expiresAt,
    payment:
      page.amountCents === null
        ? null
        : { amountCents: page.amountCents, description: `Bond for ${page.rental.carRego}` },
  });
  const kept = await keepNewPage(
    deps,
    visit,
    { rentalId: page.rental.id, purpose: page.purpose, amountCents: page.amountCents },
    { ...opened, expiresAt },
  );
  if (kept.status === "kept") {
    return { status: "started", url: opened.url };
  }
  await stripe.payments.expireCheckout(stripe.accountId, opened.sessionId);
  return kept.status === "other_page" ? { status: "started", url: kept.url } : kept;
}

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
  const payableCents = bondPayableOnlineCents(found.payments.bond.toCollectCents);
  if (purpose === "bond" && payableCents === 0) {
    return { status: "nothing_owing" };
  }
  // The same page for the same amount, so two phones or two presses can't both pay (review KS-1).
  const reusable =
    purpose === "bond"
      ? await reusableBondPage(deps, visit.operatorId, { id: found.rental.id, payableCents })
      : null;
  if (reusable) {
    return { status: "started", url: reusable };
  }
  // Checked before an old page is expired, so a Renter over the limit keeps theirs.
  const isWithinLimit = await isWithinLinkLimit(deps.database, visit, "stripePages", deps.now());
  if (!isWithinLimit) {
    return { status: "too_many" };
  }
  if (
    purpose === "bond" &&
    (await retireOpenBondPage(deps, stripe, visit.operatorId, found.rental.id)) === "just_paid"
  ) {
    return { status: "just_paid" };
  }
  const amountCents = purpose === "bond" ? payableCents : null;
  const started = await openNewPage(deps, stripe, visit, {
    rental: found.rental,
    purpose,
    amountCents,
  });
  if (started.status !== "started") {
    return started;
  }
  await withTenant(deps.database, visit.operatorId, (tx) =>
    recordActivity(tx, {
      operatorId: visit.operatorId,
      actor: { type: "renter_link", id: visit.linkId },
      entityType: ACTIVITY_ENTITY_TYPES.rental,
      entityId: found.rental.id,
      action: ACTIVITY_ACTIONS.checkoutStarted,
      valuesAfter: { purpose, ...(amountCents === null ? {} : { amountCents }) },
    }),
  );
  return started;
}

/**
 * The Renter is back from Stripe's page: what came of each page the link
 * has open is read from Stripe and recorded now, not left for Stripe's
 * message, so the page shows it at once and never offers to pay again
 * (review KS-1). A failure here is logged; Stripe's message still records it.
 */
export async function recordReturnFromStripe(
  deps: RenterCheckoutDependencies,
  visit: LinkVisit,
): Promise<void> {
  const stripe = await isStripeOfferedToRenters(deps, visit.operatorId);
  if (!stripe) {
    return;
  }
  const open = await withTenant(deps.database, visit.operatorId, (tx) =>
    openCheckoutsOfLink(tx, visit.operatorId, visit.linkId, deps.now()),
  );
  for (const page of open) {
    try {
      await recordOutcome(deps, stripe, visit.operatorId, page.sessionId);
    } catch (error) {
      console.error("Reading a Stripe page on the way back failed", describeErrorForLog(error));
    }
  }
}
