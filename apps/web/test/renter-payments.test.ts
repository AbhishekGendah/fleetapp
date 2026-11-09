import {
  bondMovements,
  paymentMandates,
  payments,
  renterLinks,
  renterStripeCustomers,
  stripeAccounts,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { continueToPayments, sendPaymentsLink } from "../src/lib/payments/payments-links";
import { loadBondAccount } from "../src/lib/bonds/bond-account";
import { recordBondReceived, reverseBondMovement } from "../src/lib/bonds/bond-records";
import { loadBondsToRefund } from "../src/lib/dashboard/bonds-to-refund";
import {
  recordReturnFromStripe,
  startRenterCheckout,
  stopBondPageAfterHandEntry,
} from "../src/lib/payments/renter-checkout";
import { runStripeTidyUp, tellStripeAboutRenter } from "../src/lib/payments/stripe-tidy-up";
import { loadRentalPayments } from "../src/lib/payments/renter-payment-records";
import { createStandInPayments, type StandInPayments } from "../src/lib/payments/stand-in-provider";
import { loadRentalProblems } from "../src/lib/rentals/booking-checks";
import { cancelRental } from "../src/lib/rentals/rental-records";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { updateRenter } from "../src/lib/renters/renter-records";
import { openLink } from "../src/lib/renter-links/link-visits";
import { seedOperatorWithUser } from "./car-fixtures";
import { PAYMENTS_WEBHOOK_SECRET, paymentsTestKit } from "./payment-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";

/** The test rental's bond: $500 (bookTestRental). */
const BOND_CENTS = 500_00;
const MONDAY = new Date("2026-11-02T01:00:00Z");
const TUESDAY = new Date("2026-11-03T01:00:00Z");

/**
 * A Renter's direct debit and bond through Stripe's page (slice 4): the
 * link to it, the visit, and what Stripe says came of it, recorded once,
 * only for the business whose account it is (rule 3), and a payment
 * counted only once it succeeded (decision 2).
 */
describe("a Renter's direct debit and bond", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let stripe: StandInPayments;
  let actor: ActingUser;
  let otherBusiness: ActingUser;
  const sentEmails: EmailMessage[] = [];

  const { deps, deliver, connectStripe, bookedRental, openedPaymentsLink, visitStripe } =
    paymentsTestKit(() => ({ web, stripe }), sentEmails);

  function paymentsOf(owner: ActingUser, rental: { rentalId: string; renterId: string }) {
    return loadRentalPayments(web.db, owner.operatorId, {
      id: rental.rentalId,
      renterId: rental.renterId,
      bondCents: BOND_CENTS,
    });
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    stripe = createStandInPayments(PAYMENTS_WEBHOOK_SECRET);
    actor = await seedOperatorWithUser(admin, "Direct Debit Rentals Pty Ltd");
    otherBusiness = await seedOperatorWithUser(admin, "Other Direct Debit Rentals Pty Ltd");
    await connectStripe(actor);
    await connectStripe(otherBusiness);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("offers Stripe's page only once the business is ready and the site hears back", async () => {
    const notReady = await seedOperatorWithUser(admin, "Not Ready Rentals Pty Ltd");
    const rental = await bookedRental(notReady);
    expect((await sendPaymentsLink(deps(), notReady, rental.rentalId, "email")).status).toBe(
      "not_offered",
    );
    const ready = await bookedRental(actor);
    expect(
      (
        await sendPaymentsLink(
          deps({ canHearRenterPayments: false }),
          actor,
          ready.rentalId,
          "email",
        )
      ).status,
    ).toBe("not_offered");
  });

  it("sends the link by email, or hands it over on the spot replacing the last one", async () => {
    const rental = await bookedRental(actor);
    const emailed = await sendPaymentsLink(deps(), actor, rental.rentalId, "email");
    const onTheSpot = await sendPaymentsLink(deps(), actor, rental.rentalId, "on_the_spot");
    expect(emailed).toMatchObject({ status: "sent", isEmailed: true });
    expect(onTheSpot).toMatchObject({ status: "sent", isEmailed: false });
    expect(sentEmails.at(-1)?.subject).toMatch(/Set up your payments/);
    // Named the way the Renter knows the rental: the car and the day it starts (review KL-6).
    expect(sentEmails.at(-1)?.text).toMatch(/[A-Z0-9]+ \S+ \S+, from /);

    const visit = await openLink(web.db, (onTheSpot as { url: string }).url.split("/r/")[1]!);
    expect(visit).toMatchObject({ purpose: "set_up_payments", rentalId: rental.rentalId });
    // The emailed one stopped working when the new one was made (rule 26).
    expect(await openLink(web.db, (emailed as { url: string }).url.split("/r/")[1]!)).toBeNull();
  });

  it("records a direct debit set up on Stripe's page once, and a newer one replaces it", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    expect((await paymentsOf(actor, rental)).directDebit).toBe("not_set_up");

    const first = await visitStripe(visit, "direct_debit");
    const finished = stripe.finishCheckout(first);
    expect(await deliver(finished)).toBe("handled");
    expect(await deliver(finished)).toBe("repeat");
    expect((await paymentsOf(actor, rental)).directDebit).toBe("active");

    const second = await visitStripe(visit, "direct_debit");
    await deliver(stripe.finishCheckout(second));
    const mandates = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ status: paymentMandates.status, endReason: paymentMandates.endReason })
        .from(paymentMandates)
        .where(eq(paymentMandates.renterId, rental.renterId)),
    );
    expect(mandates).toEqual(
      expect.arrayContaining([
        { status: "inactive", endReason: "replaced" },
        { status: "active", endReason: null },
      ]),
    );

    // The Renter's bank cancels it: the rental shows it, and handover asks again.
    await deliver(stripe.cancelMandate(second));
    expect((await paymentsOf(actor, rental)).directDebit).toBe("cancelled");
  });

  function mandatesOf(owner: ActingUser, renterId: string) {
    return withTenant(web.db, owner.operatorId, (tx) =>
      tx
        .select({
          paymentMethodId: paymentMandates.stripePaymentMethodId,
          status: paymentMandates.status,
          endReason: paymentMandates.endReason,
          isDetached: isNotNull(paymentMandates.detachedAt),
        })
        .from(paymentMandates)
        .where(eq(paymentMandates.renterId, renterId))
        .orderBy(paymentMandates.setUpAt),
    );
  }

  it("keeps the direct debit set up last when Stripe tells of an older one late (review KS-2)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const older = await visitStripe(visit, "direct_debit");
    const newer = await visitStripe(visit, "direct_debit");

    await deliver(stripe.finishCheckout(newer, undefined, { setUpAt: TUESDAY }));
    const lateEvent = stripe.finishCheckout(older, undefined, { setUpAt: MONDAY });
    expect(await deliver(lateEvent)).toBe("handled");

    const [first, second] = await mandatesOf(actor, rental.renterId);
    expect(first).toMatchObject({ status: "inactive", endReason: "replaced", isDetached: true });
    expect(stripe.isDetached(first!.paymentMethodId)).toBe(true);
    expect(second).toMatchObject({ status: "active", endReason: null, isDetached: false });
    expect((await paymentsOf(actor, rental)).directDebit).toBe("active");

    // The older one becoming active at Stripe later never brings it back.
    await deliver(stripe.setMandateStatus(older, "active"));
    expect((await mandatesOf(actor, rental.renterId))[0]?.status).toBe("inactive");
  });

  it("cancels a replaced direct debit at Stripe, and the nightly tidy-up retries it (review KS-3)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    await deliver(stripe.finishCheckout(await visitStripe(visit, "direct_debit")));
    stripe.failNextDetaches(1);
    await deliver(stripe.finishCheckout(await visitStripe(visit, "direct_debit")));
    expect((await mandatesOf(actor, rental.renterId))[0]?.isDetached).toBe(false);

    const paymentDeps = { database: web.db, payments: stripe, now: () => new Date() };
    const run = await runStripeTidyUp(paymentDeps, () => false);
    expect(run.failedOperators).toBe(0);
    const [replaced] = await mandatesOf(actor, rental.renterId);
    expect(replaced?.isDetached).toBe(true);
    expect(stripe.isDetached(replaced!.paymentMethodId)).toBe(true);
    expect((await runStripeTidyUp(paymentDeps, () => false)).done).toBe(0);
  });

  it("keeps Stripe's news about a direct debit that arrives before the direct debit itself (review KS-7)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const sessionId = await visitStripe(visit, "direct_debit");
    const finished = stripe.finishCheckout(sessionId, undefined, { mandateStatus: "pending" });
    const nowActive = stripe.setMandateStatus(sessionId, "active");

    expect(await deliver(nowActive)).toBe("not_ready");
    expect(await deliver(finished)).toBe("handled");
    expect((await paymentsOf(actor, rental)).directDebit).toBe("waiting");
    // Stripe sends it again, and this time it counts.
    expect(await deliver(nowActive)).toBe("handled");
    expect((await paymentsOf(actor, rental)).directDebit).toBe("active");
  });

  it("asks for the direct debit before handover, only when Stripe is offered", async () => {
    const rental = await bookedRental(actor);
    const row = {
      id: rental.rentalId,
      renterId: rental.renterId,
      driverId: rental.renterId,
      vehicleId: rental.vehicleId,
      plannedStart: new Date("2027-06-01T01:00:00Z"),
      plannedEnd: new Date("2027-06-29T01:00:00Z"),
      bondCents: BOND_CENTS,
      settingsSnapshot: {},
    };
    const clock = { timeZone: TEST_TIME_ZONE, now: new Date() };
    const codes = async (canHearRenterPayments: boolean) => {
      const problems = await loadRentalProblems(web.db, actor.operatorId, row, clock, {
        canHearRenterPayments,
      });
      return Array.isArray(problems) ? problems.map((problem) => problem.code) : problems;
    };
    expect(await codes(true)).toContain("direct_debit_missing");
    expect(await codes(false)).not.toContain("direct_debit_missing");

    const visit = await openedPaymentsLink(actor, rental.rentalId);
    await deliver(stripe.finishCheckout(await visitStripe(visit, "direct_debit")));
    expect(await codes(true)).not.toContain("direct_debit_missing");
  });

  it("puts a card bond on the bond account once paid, and then asks for nothing more", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const sessionId = await visitStripe(visit, "bond");
    expect(stripe.checkout(sessionId)?.request.payment?.amountCents).toBe(BOND_CENTS);

    const paid = stripe.finishCheckout(sessionId, "card");
    await deliver(paid);
    await deliver(paid);
    const after = await paymentsOf(actor, rental);
    expect(after.bond).toMatchObject({ heldCents: BOND_CENTS, toCollectCents: 0 });
    expect(after.payments).toMatchObject([{ method: "card", status: "succeeded" }]);
    expect((await startRenterCheckout(deps(), visit, "bond")).status).toBe("nothing_owing");

    const entries = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(bondMovements).where(eq(bondMovements.rentalId, rental.rentalId)),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.paymentId).toBe(after.payments[0]?.id);
  });

  async function problemsOf(
    owner: ActingUser,
    rental: { rentalId: string; renterId: string; vehicleId: string },
  ) {
    const problems = await loadRentalProblems(
      web.db,
      owner.operatorId,
      {
        id: rental.rentalId,
        renterId: rental.renterId,
        driverId: rental.renterId,
        vehicleId: rental.vehicleId,
        plannedStart: new Date("2027-06-01T01:00:00Z"),
        plannedEnd: new Date("2027-06-29T01:00:00Z"),
        bondCents: BOND_CENTS,
        settingsSnapshot: {},
      },
      { timeZone: TEST_TIME_ZONE, now: new Date() },
      { canHearRenterPayments: true },
    );
    return Array.isArray(problems) ? problems : [];
  }

  function cashBond(owner: ActingUser, rentalId: string, amountCents: number) {
    return recordBondReceived(web.db, owner, rentalId, {
      amountCents,
      method: "cash",
      reference: null,
      occurredOn: "2026-11-04",
    });
  }

  it("hands a second press, or a second phone, the same bond page, so it is paid once (review KS-1)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const onePhone = await visitStripe(visit, "bond");
    const otherPhone = await visitStripe(visit, "bond");
    expect(otherPhone).toBe(onePhone);

    // Cash taken meanwhile: the old page is expired at Stripe, a new one asks for the rest.
    await cashBond(actor, rental.rentalId, 200_00);
    const forTheRest = await visitStripe(visit, "bond");
    expect(forTheRest).not.toBe(onePhone);
    expect(stripe.checkout(onePhone)?.outcome.isExpired).toBe(true);
    expect(stripe.checkout(forTheRest)?.request.payment?.amountCents).toBe(300_00);
    expect(() => stripe.finishCheckout(onePhone)).toThrow();
  });

  it("opens a fresh bond page when the open one is about to expire", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const first = await visitStripe(visit, "bond");
    const nearlyAnHourOn = new Date(Date.now() + 58 * 60 * 1000);
    const started = await startRenterCheckout(deps({ now: () => nearlyAnHourOn }), visit, "bond");
    expect(started.status).toBe("started");
    expect(stripe.checkout(first)?.outcome.isExpired).toBe(true);
  });

  it("records a bond paid on Stripe's page as soon as the Renter comes back (review KS-1)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const card = stripe.finishCheckout(await visitStripe(visit, "bond"), "card");

    await recordReturnFromStripe(deps(), visit);
    expect((await paymentsOf(actor, rental)).bond).toMatchObject({
      heldCents: BOND_CENTS,
      toCollectCents: 0,
    });
    expect((await startRenterCheckout(deps(), visit, "bond")).status).toBe("nothing_owing");
    // Stripe's own message arrives after: nothing is added twice.
    expect(await deliver(card)).toBe("handled");
    expect((await paymentsOf(actor, rental)).bond.heldCents).toBe(BOND_CENTS);
  });

  it("counts a bank debit bond finished on Stripe's page as on its way at once, never as owing", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    stripe.finishCheckout(await visitStripe(visit, "bond"), "becs_debit");

    await recordReturnFromStripe(deps(), visit);
    expect((await paymentsOf(actor, rental)).bond).toMatchObject({
      heldCents: 0,
      pendingCents: BOND_CENTS,
      toCollectCents: 0,
    });
    expect((await startRenterCheckout(deps(), visit, "bond")).status).toBe("nothing_owing");
  });

  it("offers no Stripe page for a bond remainder under Stripe's 50 cent minimum (review KM-2)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    await cashBond(actor, rental.rentalId, BOND_CENTS - 25);
    expect((await paymentsOf(actor, rental)).bond.toCollectCents).toBe(25);
    expect((await startRenterCheckout(deps(), visit, "bond")).status).toBe("nothing_owing");
  });

  it("names a bank debit bond still clearing at handover and on the bond, never as held (review A5-2)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    await deliver(stripe.finishCheckout(await visitStripe(visit, "bond"), "becs_debit"));

    const account = await loadBondAccount(web.db, actor.operatorId, {
      id: rental.rentalId,
      bondCents: BOND_CENTS,
    });
    expect(account).toMatchObject({
      heldCents: 0,
      owingCents: BOND_CENTS,
      onItsWayCents: BOND_CENTS,
      toReceiveByHandCents: 0,
    });
    // Cash taken again while it clears is refused: the business would hold it twice.
    expect(await cashBond(actor, rental.rentalId, 100_00)).toMatchObject({
      status: "on_its_way",
      onItsWayCents: BOND_CENTS,
    });
    const problems = await problemsOf(actor, rental);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: "bond_short", onItsWayCents: BOND_CENTS }),
    );
  });

  it("dates a bond paid through Stripe by when Stripe says it cleared (review A11-10)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const sessionId = await visitStripe(visit, "bond");
    await deliver(stripe.finishCheckout(sessionId, "becs_debit"));
    // 11:30 pm in Perth on 2 Nov, told to us later.
    await deliver(stripe.settlePayment(sessionId, true, new Date("2026-11-02T15:30:00Z")));

    const [entry] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(bondMovements).where(eq(bondMovements.rentalId, rental.rentalId)),
    );
    expect(entry?.occurredOn).toBe("2026-11-02");
  });

  it("lets no Stripe bond entry be corrected here (review A5-3)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    await deliver(stripe.finishCheckout(await visitStripe(visit, "bond"), "card"));
    const [entry] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(bondMovements).where(eq(bondMovements.rentalId, rental.rentalId)),
    );
    const result = await reverseBondMovement(
      web.db,
      actor,
      { rentalId: rental.rentalId, movementId: entry!.id },
      { note: "Paid twice" },
      "2026-11-04",
    );
    expect(result.status).toBe("not_reversible");
  });

  it("lists a cancelled booking still holding bond to refund (review A5-8)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const sessionId = await visitStripe(visit, "bond");
    await deliver(stripe.finishCheckout(sessionId, "becs_debit"));
    await cancelRental(
      web.db,
      actor,
      rental.rentalId,
      { reason: "Changed their mind" },
      new Date(),
    );
    // The bank debit clears after the booking was cancelled: still recorded, and flagged.
    await deliver(stripe.settlePayment(sessionId, true));

    const toRefund = await loadBondsToRefund(web.db, actor.operatorId);
    expect(toRefund.items).toContainEqual(
      expect.objectContaining({ rentalId: rental.rentalId, heldCents: BOND_CENTS }),
    );
    expect((await loadBondsToRefund(web.db, otherBusiness.operatorId)).total).toBe(0);
  });

  /** A rental whose $500 bond the Renter paid by card on Stripe's page. Gives its Stripe page. */
  async function paidByCard() {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const sessionId = await visitStripe(visit, "bond");
    await deliver(stripe.finishCheckout(sessionId, "card"));
    return { rental, visit, sessionId };
  }

  it("takes a refund made in Stripe off the bond, once, and shows it on the payment (review A5-4)", async () => {
    const { rental, sessionId } = await paidByCard();
    const { event, objectId } = stripe.takeBack(sessionId, { kind: "refund", amountCents: 200_00 });
    expect(await deliver(event)).toBe("handled");
    expect(await deliver(stripe.settleTakeBack(objectId, "taken"))).toBe("handled");

    const after = await paymentsOf(actor, rental);
    expect(after.bond.heldCents).toBe(300_00);
    expect(after.payments[0]).toMatchObject({ takenBackCents: 200_00, isDisputed: false });

    // Stripe couldn't make it after all: the bond is held in full again.
    await deliver(stripe.settleTakeBack(objectId, "failed"));
    await deliver(stripe.settleTakeBack(objectId, "failed"));
    const failed = await paymentsOf(actor, rental);
    expect(failed.bond.heldCents).toBe(BOND_CENTS);
    expect(failed.payments[0]?.takenBackCents).toBe(0);
  });

  it("takes disputed bond off the bond, and puts it back once the dispute is won (review A5-4)", async () => {
    const { rental, sessionId } = await paidByCard();
    const { event, objectId } = stripe.takeBack(sessionId, {
      kind: "dispute",
      amountCents: BOND_CENTS,
    });
    await deliver(event);
    const disputed = await paymentsOf(actor, rental);
    expect(disputed.bond.heldCents).toBe(0);
    expect(disputed.payments[0]).toMatchObject({ takenBackCents: BOND_CENTS, isDisputed: true });

    await deliver(stripe.settleTakeBack(objectId, "returned"));
    const won = await paymentsOf(actor, rental);
    expect(won.bond.heldCents).toBe(BOND_CENTS);
    expect(won.payments[0]).toMatchObject({ takenBackCents: 0, isDisputed: false });
  });

  it("tells Stripe a Renter's new email straight after the save, and overnight if that fails (review A5-6)", async () => {
    const { rental } = await paidByCard();
    const [customer] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ id: renterStripeCustomers.stripeCustomerId })
        .from(renterStripeCustomers)
        .where(eq(renterStripeCustomers.renterId, rental.renterId)),
    );
    const paymentDeps = { database: web.db, payments: stripe, now: () => new Date() };
    const edit = (email: string) =>
      updateRenter(
        web.db,
        actor,
        rental.renterId,
        parseRenterForm(
          { ...emptyRenterForm(), fullName: "Pat Payer", email, phone: "0412345678" },
          "2026-10-30",
        ).data!,
      );

    await edit("pat.new@example.test");
    await tellStripeAboutRenter(paymentDeps, actor.operatorId, rental.renterId);
    expect(stripe.customer(customer!.id)?.email).toBe("pat.new@example.test");

    stripe.failNextCustomerUpdates(1);
    await edit("pat.newer@example.test");
    await tellStripeAboutRenter(paymentDeps, actor.operatorId, rental.renterId);
    expect(stripe.customer(customer!.id)?.email).toBe("pat.new@example.test");
    await runStripeTidyUp(paymentDeps, () => false);
    expect(stripe.customer(customer!.id)?.email).toBe("pat.newer@example.test");
  });

  it("opens no more than ten Stripe pages an hour from one link (review G6-6)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const statuses = [];
    for (let press = 0; press < 11; press += 1) {
      statuses.push((await startRenterCheckout(deps(), visit, "direct_debit")).status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill("started"));
    expect(statuses[10]).toBe("too_many");
    const anHourOn = new Date(Date.now() + 60 * 60 * 1000);
    expect(
      (await startRenterCheckout(deps({ now: () => anHourOn }), visit, "direct_debit")).status,
    ).toBe("started");
  });

  it("keeps the working direct debit until a newer one is active (deep review of batch 2)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    await deliver(stripe.finishCheckout(await visitStripe(visit, "direct_debit")));
    const newer = await visitStripe(visit, "direct_debit");
    await deliver(stripe.finishCheckout(newer, undefined, { mandateStatus: "pending" }));

    const whileChecked = await mandatesOf(actor, rental.renterId);
    expect(whileChecked.map((mandate) => mandate.status)).toEqual(["active", "waiting"]);
    expect(whileChecked[0]?.isDetached).toBe(false);

    await deliver(stripe.setMandateStatus(newer, "active"));
    const [old, current] = await mandatesOf(actor, rental.renterId);
    expect(old).toMatchObject({ status: "inactive", endReason: "replaced", isDetached: true });
    expect(current?.status).toBe("active");
  });

  it("leaves news about a direct debit that was never ours, instead of failing for days", async () => {
    const accountId = (
      await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select({ id: stripeAccounts.stripeAccountId }).from(stripeAccounts),
      )
    )[0]!.id;
    const old = stripe.signedEvent({
      id: `evt_old_${Date.now()}`,
      type: "v1.mandate.updated",
      accountId,
      objectId: "mandate_madeinthedashboard",
      occurredAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    expect(await deliver(old)).toBe("handled");
  });

  it("waits for the bond payment before taking a refund off it (deep review of batch 2)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const sessionId = await visitStripe(visit, "bond");
    const paid = stripe.finishCheckout(sessionId, "card");
    const { event: refund } = stripe.takeBack(sessionId, { kind: "refund", amountCents: 100_00 });

    expect(await deliver(refund)).toBe("not_ready");
    await deliver(paid);
    expect(await deliver(refund)).toBe("handled");
    expect((await paymentsOf(actor, rental)).bond.heldCents).toBe(400_00);
  });

  it("stops the open Stripe bond page once bond is recorded by hand (deep review of batch 2)", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const sessionId = await visitStripe(visit, "bond");
    const cash = await cashBond(actor, rental.rentalId, BOND_CENTS);

    expect(cash).toMatchObject({ status: "saved", openBondPageId: sessionId });
    expect(await stopBondPageAfterHandEntry(deps(), actor.operatorId, sessionId)).toBe("expired");
    expect(await stopBondPageAfterHandEntry(deps(), actor.operatorId, null)).toBe("none");
    expect(stripe.checkout(sessionId)?.outcome.isExpired).toBe(true);
    expect(() => stripe.finishCheckout(sessionId)).toThrow();
  });

  it("says so when the Renter paid on Stripe's page just before the cash was recorded", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const sessionId = await visitStripe(visit, "bond");
    stripe.finishCheckout(sessionId, "card");
    await cashBond(actor, rental.rentalId, BOND_CENTS);

    expect(await stopBondPageAfterHandEntry(deps(), actor.operatorId, sessionId)).toBe("just_paid");
    expect((await paymentsOf(actor, rental)).bond.heldCents).toBe(2 * BOND_CENTS);
  });

  it("counts a bank debit bond only once it clears; a bounced one is asked for again", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const bounced = await visitStripe(visit, "bond");
    await deliver(stripe.finishCheckout(bounced, "becs_debit"));
    expect((await paymentsOf(actor, rental)).bond).toMatchObject({
      heldCents: 0,
      pendingCents: BOND_CENTS,
      toCollectCents: 0,
    });

    await deliver(stripe.settlePayment(bounced, false));
    const afterBounce = await paymentsOf(actor, rental);
    expect(afterBounce.bond).toMatchObject({ heldCents: 0, toCollectCents: BOND_CENTS });
    expect(afterBounce.payments[0]).toMatchObject({
      status: "failed",
      failureCode: "insufficient_funds",
    });

    const cleared = await visitStripe(visit, "bond");
    await deliver(stripe.finishCheckout(cleared, "becs_debit"));
    await deliver(stripe.settlePayment(cleared, true));
    expect((await paymentsOf(actor, rental)).bond).toMatchObject({
      heldCents: BOND_CENTS,
      toCollectCents: 0,
    });
  });

  it("never records one business's payment through another business's account", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const sessionId = await visitStripe(visit, "bond");
    stripe.finishCheckout(sessionId, "card");
    const [otherAccount] = await withTenant(web.db, otherBusiness.operatorId, (tx) =>
      tx.select().from(stripeAccounts),
    );
    const forged = stripe.signedEvent({
      id: `evt_forged_${Date.now()}`,
      type: "v1.checkout.session.completed",
      accountId: otherAccount!.stripeAccountId,
      objectId: sessionId,
    });
    expect(await deliver(forged)).toBe("handled");
    const recorded = [
      ...(await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select().from(payments).where(eq(payments.rentalId, rental.rentalId)),
      )),
      ...(await withTenant(web.db, otherBusiness.operatorId, (tx) => tx.select().from(payments))),
    ];
    expect(recorded).toEqual([]);
  });

  it("carries the Renter on from signing to a payments link this phone already passed", async () => {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    const carried = await continueToPayments(deps(), { ...visit, purpose: "sign_contract" });
    expect(carried).not.toBeNull();
    const next = await openLink(web.db, carried!.token);
    expect(next).toMatchObject({ purpose: "set_up_payments", rentalId: rental.rentalId });

    // Nothing left to do: no link.
    await deliver(stripe.finishCheckout(await visitStripe(next!, "direct_debit")));
    await deliver(stripe.finishCheckout(await visitStripe(next!, "bond"), "card"));
    expect(await continueToPayments(deps(), { ...next!, purpose: "sign_contract" })).toBeNull();
  });

  /** The Renter's email changed while they were on their signing link (the change cancels it). */
  async function emailChangedDuringSigning() {
    const rental = await bookedRental(actor);
    const visit = await openedPaymentsLink(actor, rental.rentalId);
    await updateRenter(
      web.db,
      actor,
      rental.renterId,
      parseRenterForm(
        { ...emptyRenterForm(), fullName: "Pat Payer", email: "pat.moved@example.test" },
        "2026-10-30",
      ).data!,
    );
    return { rental, signing: { ...visit, purpose: "sign_contract" as const } };
  }

  function liveLinksOf(rentalId: string) {
    return withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ id: renterLinks.id })
        .from(renterLinks)
        .where(and(eq(renterLinks.rentalId, rentalId), isNull(renterLinks.cancelledAt))),
    );
  }

  it("doesn't carry the Renter on once their email changed and cancelled the signing link", async () => {
    const { rental, signing } = await emailChangedDuringSigning();

    expect(await continueToPayments(deps(), signing)).toBeNull();
    expect(await liveLinksOf(rental.rentalId)).toEqual([]);
    // The Operator sends one the usual way, to the new email, and a new phone types its code.
    expect(await sendPaymentsLink(deps(), actor, rental.rentalId, "email")).toMatchObject({
      status: "sent",
    });
  });

  it("doesn't carry the Renter on from a signing link sent to an email no longer theirs", async () => {
    const { rental, signing } = await emailChangedDuringSigning();
    // Even were the signing link still live: it went to the old email, so its phone isn't remembered.
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx.update(renterLinks).set({ cancelledAt: null }).where(eq(renterLinks.id, signing.linkId)),
    );

    expect(await continueToPayments(deps(), signing)).toBeNull();
    expect((await liveLinksOf(rental.rentalId)).map((link) => link.id)).toEqual([signing.linkId]);
  });
});
