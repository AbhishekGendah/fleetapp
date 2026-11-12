import { randomUUID } from "node:crypto";

import { addDays, debitDescription, todayInTimeZone } from "@fleetapp/core";
import {
  activityLog,
  debitItems,
  debitPlans,
  operators,
  paymentLedgerLines,
  paymentMandates,
  payments,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { setDebitsPaused } from "../src/lib/debits/debit-pause";
import { changeDebitPlan } from "../src/lib/debits/debit-plans";
import { wasRefusedOverLimitRecently } from "../src/lib/debits/debit-queries";
import { debitsForOperator, runDebitJob } from "../src/lib/debits/debit-run";
import { loadRentalDebitState } from "../src/lib/debits/rental-debits";
import { listChargeTypes } from "../src/lib/ledger/charge-types";
import { loadRentalLedger } from "../src/lib/ledger/ledger-queries";
import { addCharge, recordPayment, reverseLine } from "../src/lib/ledger/ledger-records";
import { chargeRentFor } from "../src/lib/ledger/rent-job";
import { handlePaymentEvent, type PaymentDependencies } from "../src/lib/payments/payment-accounts";
import {
  createStandInPayments,
  type SignedEvent,
  type StandInPayments,
} from "../src/lib/payments/stand-in-provider";
import { seedOperatorWithUser } from "./car-fixtures";
import { debitTestKit, OUT_FOR_MS } from "./debit-fixtures";
import { oneAfterTheOther } from "./lock-fixtures";
import { PAYMENTS_WEBHOOK_SECRET, paymentsTestKit } from "./payment-fixtures";
import { addTestRenter } from "./rental-fixtures";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** The test booking's weekly rent (attemptTestBooking). */
const RENT_CENTS = 350_00;
const LOCK_RENTAL = "select id from rentals where id = $1 for no key update";

function stripeId(prefix: string): string {
  return `${prefix}_standin${randomUUID().replaceAll("-", "")}`;
}

/**
 * Weekly debits (docs/plans/phase-4-slice-5.md) against Stripe's stand-in:
 * the week's rent asked for once, counted only once Stripe says it cleared,
 * capped at what is owing, recovered after a crash without a second debit,
 * refunds and disputes as new ledger lines, one-off charges as the business
 * chose, kept to the business (rule 3) and safe against the rental's other
 * changes (the lock order).
 */
describe("weekly debits", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: TestConnection;
  let superuserClient: Client;
  let stripe: StandInPayments;
  let actor: ActingUser;
  let otherActor: ActingUser;
  const kit = paymentsTestKit(() => ({ web, stripe }));

  const depsAt = (now: Date): PaymentDependencies => ({
    database: web.db,
    payments: stripe,
    now: () => now,
  });
  const runAt = (now: Date, owner: ActingUser = actor) =>
    debitsForOperator(depsAt(now), owner.operatorId);
  const deliver = (event: SignedEvent, now = new Date()) =>
    handlePaymentEvent(depsAt(now), event.payload, event.signature);

  const debitKit = debitTestKit(() => ({ web, superuser }));
  const { addDirectDebit } = debitKit;
  const rentalOut = (
    owner: ActingUser = actor,
    options: { renterId?: string; handedOverAt?: Date } = {},
  ) => debitKit.rentalOut(owner, options);

  async function debitsOf(rentalId: string, owner: ActingUser = actor) {
    return withTenant(web.db, owner.operatorId, (tx) =>
      tx
        .select()
        .from(payments)
        .where(and(eq(payments.operatorId, owner.operatorId), eq(payments.rentalId, rentalId))),
    );
  }

  async function onlyDebit(rentalId: string) {
    const all = await debitsOf(rentalId);
    expect(all).toHaveLength(1);
    return all[0]!;
  }

  async function ledgerOf(rentalId: string) {
    return loadRentalLedger(web.db, actor.operatorId, rentalId);
  }

  function madeFor(paymentId: string) {
    return stripe.debitsMade().filter((debit) => debit.request.paymentId === paymentId);
  }

  async function typeId(label: string): Promise<string> {
    return (await listChargeTypes(web.db, actor.operatorId)).find((type) => type.label === label)!
      .id;
  }

  async function addCleaning(
    rentalId: string,
    collection: Parameters<typeof addCharge>[3]["collection"],
    amountCents = 120_00,
  ) {
    const added = await addCharge(web.db, actor, rentalId, {
      chargeTypeId: await typeId("Cleaning"),
      amountCents,
      description: "Interior cleaning",
      effectiveOn: todayInTimeZone(new Date(), "Australia/Perth"),
      collection,
    });
    if (added.status !== "saved") {
      throw new Error(added.status);
    }
    return added.lineId;
  }

  /**
   * As the charge's invoice email leaves it (docs/plans/one-off-charge-notice.md):
   * its plan's first debit day, `days` from today on the business's (Perth) clock.
   */
  async function giveNotice(ledgerLineId: string, days = 0, owner: ActingUser = actor) {
    const noticeDate = addDays(todayInTimeZone(new Date(), "Australia/Perth"), days);
    await withTenant(web.db, owner.operatorId, (tx) =>
      tx.update(debitPlans).set({ noticeDate }).where(eq(debitPlans.ledgerLineId, ledgerLineId)),
    );
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    superuserClient = new Client({ connectionString: inject("superuserUrl") });
    await superuserClient.connect();
    stripe = createStandInPayments(PAYMENTS_WEBHOOK_SECRET);
    actor = await seedOperatorWithUser(admin, "Weekly Debits Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Debits Pty Ltd");
    await kit.connectStripe(actor);
    await kit.connectStripe(otherActor);
  });

  afterAll(async () => {
    await superuserClient.end();
    await Promise.all([admin.close(), web.close(), superuser.close()]);
  });

  describe("the week's debit", () => {
    it("asks Stripe for the second week's rent once, by car and week, never the first week", async () => {
      const { rentalId, vehicleId, handedOverAt } = await rentalOut();
      const now = new Date();

      await runAt(now);
      await runAt(now);
      const debit = await onlyDebit(rentalId);
      expect(debit).toMatchObject({
        purpose: "scheduled_debit",
        amountCents: RENT_CENTS,
        status: "pending",
        periodStartsAt: new Date(handedOverAt.getTime() + 7 * DAY_MS),
      });
      const [made] = madeFor(debit.id);
      expect(
        stripe.debitsMade().filter((each) => each.request.paymentId === debit.id),
      ).toHaveLength(1);
      expect(made!.read.paymentIntentId).toBe(debit.stripePaymentIntentId);
      const [car] = await superuser.db
        .execute<{ rego: string }>(sql`select rego from vehicles where id = ${vehicleId}`)
        .then((result) => result.rows);
      expect(made!.request.description).toBe(
        debitDescription(
          { kind: "rent", weekStartsAt: debit.periodStartsAt! },
          car!.rego,
          "Australia/Perth",
        ),
      );
      expect(made!.request.description).not.toContain("Sam");
      // Pending is never counted as paid (decision 2).
      expect((await ledgerOf(rentalId)).balanceCents).toBe(2 * RENT_CENTS);
    });

    it("runs two at once and still asks once", async () => {
      const { rentalId } = await rentalOut();
      const now = new Date();
      await Promise.all([runAt(now), runAt(now)]);
      const debit = await onlyDebit(rentalId);
      expect(madeFor(debit.id)).toHaveLength(1);
    });

    it("counts the money only once Stripe says it cleared, once however often it is told", async () => {
      const { rentalId } = await rentalOut();
      await runAt(new Date());
      const debit = await onlyDebit(rentalId);
      const cleared = stripe.settleDebit(debit.stripePaymentIntentId!, true, { feeCents: 2_10 });

      expect(await deliver(cleared)).toBe("handled");
      expect(await deliver(cleared)).toBe("repeat");
      expect(await onlyDebit(rentalId)).toMatchObject({
        status: "succeeded",
        stripeFeeCents: 2_10,
      });
      const ledger = await ledgerOf(rentalId);
      const paid = ledger.lines.filter((line) => line.kind === "payment");
      expect(paid).toEqual([
        expect.objectContaining({
          amountCents: RENT_CENTS,
          method: "becs_debit",
          isFromStripe: true,
        }),
      ]);
      expect(ledger.balanceCents).toBe(RENT_CENTS);
      // Stripe's line is never offered for reversal, and refused if tried (decision 8).
      expect(ledger.reversibleIds.has(paid[0]!.id)).toBe(false);
      const reversed = await reverseLine(
        web.db,
        actor,
        { rentalId, lineId: paid[0]!.id },
        { note: "Wrong" },
        "2026-11-10",
      );
      expect(reversed.status).toBe("not_reversible");
    });

    it("adds no line when the bank bounces it, and keeps Stripe's reason", async () => {
      const { rentalId } = await rentalOut();
      await runAt(new Date());
      const debit = await onlyDebit(rentalId);
      await deliver(stripe.settleDebit(debit.stripePaymentIntentId!, false));
      expect(await onlyDebit(rentalId)).toMatchObject({
        status: "failed",
        failureCode: "insufficient_funds",
      });
      expect((await ledgerOf(rentalId)).lines.some((line) => line.kind === "payment")).toBe(false);
    });

    it("takes no more than is owing less what is pending, and nothing under 50c or in credit", async () => {
      const capped = await rentalOut();
      await recordPayment(web.db, actor, capped.rentalId, {
        amountCents: 2 * RENT_CENTS - 100_00,
        method: "cash",
        reference: null,
        occurredOn: "2026-11-09",
      });
      await runAt(new Date());
      expect((await onlyDebit(capped.rentalId)).amountCents).toBe(100_00);

      const tiny = await rentalOut();
      await recordPayment(web.db, actor, tiny.rentalId, {
        amountCents: 2 * RENT_CENTS - 49,
        method: "cash",
        reference: null,
        occurredOn: "2026-11-09",
      });
      const inCredit = await rentalOut();
      await recordPayment(web.db, actor, inCredit.rentalId, {
        amountCents: 3 * RENT_CENTS,
        method: "cash",
        reference: null,
        occurredOn: "2026-11-09",
      });
      await runAt(new Date());
      expect(await debitsOf(tiny.rentalId)).toEqual([]);
      expect(await debitsOf(inCredit.rentalId)).toEqual([]);
    });

    it("leaves a week over 7 days old owing", async () => {
      const { rentalId } = await rentalOut(actor, {
        handedOverAt: new Date(Date.now() - 14 * DAY_MS - HOUR_MS),
      });
      // Weeks 2 and 3 are charged; only week 3 started in the last 7 days.
      await runAt(new Date());
      const debit = await onlyDebit(rentalId);
      expect(debit.periodStartsAt!.getTime()).toBeGreaterThan(Date.now() - 7 * DAY_MS);
    });

    it("skips a paused rental, and never debits later a week that began while paused", async () => {
      const { rentalId } = await rentalOut();
      expect(
        await setDebitsPaused(web.db, actor, rentalId, { reason: "Payment arrangement" }),
      ).toBe("done");
      await runAt(new Date());
      expect(await debitsOf(rentalId)).toEqual([]);
      expect(await setDebitsPaused(web.db, actor, rentalId, null)).toBe("done");
      await runAt(new Date());
      expect(await debitsOf(rentalId)).toEqual([]);
    });

    it("reserves nothing for a direct debit whose Renter is not a Stripe customer", async () => {
      const renterId = await addTestRenter(web, actor);
      await withTenant(web.db, actor.operatorId, (tx) =>
        tx.insert(paymentMandates).values({
          operatorId: actor.operatorId,
          renterId,
          method: "becs_debit",
          status: "active",
          stripeSetupIntentId: stripeId("seti"),
          stripePaymentMethodId: stripeId("pm"),
          stripeMandateId: stripeId("mandate"),
          setUpAt: new Date(),
          activatedAt: new Date(),
        }),
      );
      const { rentalId } = await rentalOut(actor, { renterId });
      await runAt(new Date());
      expect(await debitsOf(rentalId)).toEqual([]);
    });

    it("skips a suspended business, and one whose Stripe can't take debits", async () => {
      const business = await seedOperatorWithUser(admin, "Suspended Debits Pty Ltd");
      await kit.connectStripe(business);
      const { rentalId } = await rentalOut(business);
      await superuser.db.execute(
        sql`update operators set suspended_at = now() where id = ${business.operatorId}`,
      );
      expect(await runAt(new Date(), business)).toBe(0);
      expect(await debitsOf(rentalId, business)).toEqual([]);
    });

    it("shows a debit refused over the BECS limit as failed, and the reminder again", async () => {
      const { rentalId } = await rentalOut();
      stripe.refuseNextDebits(1, "amount_too_large");
      await runAt(new Date());
      expect(await onlyDebit(rentalId)).toMatchObject({
        status: "failed",
        failureCode: "amount_too_large",
      });
      expect(await wasRefusedOverLimitRecently(web.db, actor.operatorId, new Date())).toBe(true);
    });

    it("gives one Renter's three cars three debits on its one direct debit, a credit on one lowering none", async () => {
      // As a business pays for its cars: one direct debit, a debit per car (business Renters decision 6).
      const businessId = await addTestRenter(web, actor, "Acme Rides Pty Ltd");
      await addDirectDebit(actor, businessId);
      const cars = [
        await rentalOut(actor, { renterId: businessId }),
        await rentalOut(actor, { renterId: businessId }),
        await rentalOut(actor, { renterId: businessId }),
      ];
      await recordPayment(web.db, actor, cars[0]!.rentalId, {
        amountCents: 5 * RENT_CENTS,
        method: "cash",
        reference: null,
        occurredOn: "2026-11-09",
      });
      await runAt(new Date());
      expect(await debitsOf(cars[0]!.rentalId)).toEqual([]);
      for (const car of cars.slice(1)) {
        expect((await onlyDebit(car.rentalId)).amountCents).toBe(RENT_CENTS);
      }
      const mandates = new Set(
        (await Promise.all(cars.slice(1).map((car) => onlyDebit(car.rentalId)))).map(
          (debit) => debit.mandateId,
        ),
      );
      expect(mandates.size).toBe(1);
    });
  });

  describe("when something goes wrong part way", () => {
    it("asks again with the same key after a lost answer, leaving one under 15 minutes alone", async () => {
      const { rentalId } = await rentalOut();
      const now = new Date();
      stripe.loseNextDebitAnswers(1);
      await runAt(now);
      const reserved = await onlyDebit(rentalId);
      expect(reserved.stripePaymentIntentId).toBeNull();

      await runAt(new Date(now.getTime() + 10 * MINUTE_MS));
      expect((await onlyDebit(rentalId)).stripePaymentIntentId).toBeNull();
      await runAt(new Date(now.getTime() + 20 * MINUTE_MS));
      const recovered = await onlyDebit(rentalId);
      expect(madeFor(reserved.id)).toHaveLength(1);
      expect(recovered.stripePaymentIntentId).toBe(madeFor(reserved.id)[0]!.read.paymentIntentId);
    });

    it("after 23 hours finds the debit Stripe made by our ID, or marks it not sent and never sends it", async () => {
      const found = await rentalOut();
      const now = new Date();
      stripe.loseNextDebitAnswers(1);
      await runAt(now);
      const lost = await onlyDebit(found.rentalId);
      await runAt(new Date(now.getTime() + 24 * HOUR_MS));
      expect((await onlyDebit(found.rentalId)).stripePaymentIntentId).toBe(
        madeFor(lost.id)[0]!.read.paymentIntentId,
      );

      const never = await rentalOut();
      stripe.failNextDebitRequests(1);
      await runAt(now);
      const unsent = await onlyDebit(never.rentalId);
      await runAt(new Date(now.getTime() + 24 * HOUR_MS));
      expect(await onlyDebit(never.rentalId)).toMatchObject({
        status: "failed",
        failureCode: "not_sent",
      });
      await runAt(new Date(now.getTime() + 25 * HOUR_MS));
      expect(madeFor(unsent.id)).toEqual([]);
      expect(await debitsOf(never.rentalId)).toHaveLength(1);
    });

    /** What Stripe would have been asked for this debit, made at the stand-in only now. */
    async function makeAtStripeLate(paymentId: string) {
      const [row] = (
        await superuser.db.execute<{
          account: string;
          customer: string;
          method: string;
          mandate: string;
          amount: number;
        }>(sql`select a.stripe_account_id as account, c.stripe_customer_id as customer,
            m.stripe_payment_method_id as method, m.stripe_mandate_id as mandate,
            p.amount_cents as amount
          from payments p
          join stripe_accounts a on a.operator_id = p.operator_id
          join renter_stripe_customers c on c.renter_id = p.renter_id
          join payment_mandates m on m.id = p.mandate_id
          where p.id = ${paymentId}`)
      ).rows;
      const answer = await stripe.createDebit(row!.account, {
        paymentId,
        customerId: row!.customer,
        paymentMethodId: row!.method,
        mandateId: row!.mandate,
        amountCents: row!.amount,
        description: "Made late",
      });
      if (answer.status !== "sent") {
        throw new Error("The stand-in refused it.");
      }
      return answer.debit.paymentIntentId;
    }

    it("records a debit marked not sent that Stripe says succeeded, with its payment line", async () => {
      const { rentalId } = await rentalOut();
      const now = new Date();
      stripe.failNextDebitRequests(1);
      await runAt(now);
      await runAt(new Date(now.getTime() + 24 * HOUR_MS));
      const unsent = await onlyDebit(rentalId);
      expect(unsent).toMatchObject({ status: "failed", failureCode: "not_sent" });
      const paymentIntentId = await makeAtStripeLate(unsent.id);

      expect(await deliver(stripe.settleDebit(paymentIntentId, true))).toBe("handled");
      expect(await onlyDebit(rentalId)).toMatchObject({
        status: "succeeded",
        failureCode: null,
        stripePaymentIntentId: paymentIntentId,
      });
      expect((await ledgerOf(rentalId)).balanceCents).toBe(RENT_CENTS);
    });

    it("alerts AGS when a debit Stripe refused later says it succeeded", async () => {
      const { rentalId } = await rentalOut();
      stripe.refuseNextDebits(1, "insufficient_funds");
      await runAt(new Date());
      const refused = await onlyDebit(rentalId);
      const paymentIntentId = await makeAtStripeLate(refused.id);
      const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await deliver(stripe.settleDebit(paymentIntentId, true));
        expect(alert).toHaveBeenCalledWith(
          expect.stringContaining("marked failed has succeeded at Stripe"),
          expect.objectContaining({ paymentId: refused.id, paymentIntentId }),
        );
      } finally {
        alert.mockRestore();
      }
      expect((await onlyDebit(rentalId)).status).toBe("failed");
    });

    it("looks a reserved debit up instead of asking again once its rental is paused", async () => {
      const { rentalId } = await rentalOut();
      const now = new Date();
      stripe.failNextDebitRequests(1);
      await runAt(now);
      const reserved = await onlyDebit(rentalId);
      await setDebitsPaused(web.db, actor, rentalId, { reason: "Arrangement" });
      await runAt(new Date(now.getTime() + 20 * MINUTE_MS));
      expect(madeFor(reserved.id)).toEqual([]);
      expect(await onlyDebit(rentalId)).toMatchObject({
        status: "failed",
        failureCode: "not_sent",
      });
    });

    it("matches Stripe's message before its ID was saved, by our ID, amount, customer and mandate", async () => {
      const { rentalId } = await rentalOut();
      stripe.loseNextDebitAnswers(1);
      await runAt(new Date());
      const reserved = await onlyDebit(rentalId);
      const [made] = madeFor(reserved.id);
      expect(await deliver(stripe.settleDebit(made!.read.paymentIntentId, true))).toBe("handled");
      expect(await onlyDebit(rentalId)).toMatchObject({
        status: "succeeded",
        stripePaymentIntentId: made!.read.paymentIntentId,
      });
      expect((await ledgerOf(rentalId)).balanceCents).toBe(RENT_CENTS);
    });

    it("reads again a debit pending over 7 days, and with its late message adds one line", async () => {
      const { rentalId } = await rentalOut();
      const now = new Date();
      await runAt(now);
      const debit = await onlyDebit(rentalId);
      const message = stripe.settleDebit(debit.stripePaymentIntentId!, true);
      await runAt(new Date(now.getTime() + 8 * DAY_MS));
      expect(await deliver(message)).toBe("handled");
      const ledger = await ledgerOf(rentalId);
      expect(ledger.lines.filter((line) => line.kind === "payment")).toHaveLength(1);
      expect((await onlyDebit(rentalId)).status).toBe("succeeded");
    });
  });

  describe("refunds and disputes of a debit", () => {
    async function clearedDebit() {
      const { rentalId } = await rentalOut();
      await runAt(new Date());
      const debit = await onlyDebit(rentalId);
      await deliver(stripe.settleDebit(debit.stripePaymentIntentId!, true));
      return { rentalId, paymentIntentId: debit.stripePaymentIntentId! };
    }

    it("adds a refund line, and reverses it if the refund fails", async () => {
      const { rentalId, paymentIntentId } = await clearedDebit();
      const { event, objectId } = stripe.takeBackDebit(paymentIntentId, {
        kind: "refund",
        amountCents: 50_00,
      });
      expect(await deliver(event)).toBe("handled");
      expect((await ledgerOf(rentalId)).balanceCents).toBe(RENT_CENTS + 50_00);
      expect(await deliver(stripe.settleTakeBack(objectId, "failed"))).toBe("handled");
      expect((await ledgerOf(rentalId)).balanceCents).toBe(RENT_CENTS);
    });

    it("adds a refund line of what the bank took after a part refund, and a payment line when won", async () => {
      const { rentalId, paymentIntentId } = await clearedDebit();
      await deliver(
        stripe.takeBackDebit(paymentIntentId, { kind: "refund", amountCents: 50_00 }).event,
      );
      const dispute = stripe.takeBackDebit(paymentIntentId, {
        kind: "dispute",
        amountCents: 300_00,
      });
      expect(await deliver(dispute.event)).toBe("handled");
      expect(await deliver(dispute.event)).toBe("repeat");
      expect((await ledgerOf(rentalId)).balanceCents).toBe(RENT_CENTS + 350_00);
      await deliver(stripe.settleTakeBack(dispute.objectId, "returned"));
      const ledger = await ledgerOf(rentalId);
      expect(ledger.balanceCents).toBe(RENT_CENTS + 50_00);
      const links = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ reason: paymentLedgerLines.reason })
          .from(paymentLedgerLines)
          .where(eq(paymentLedgerLines.rentalId, rentalId)),
      );
      expect(links.map((link) => link.reason).sort()).toEqual([
        "dispute_lost",
        "dispute_won",
        "refund",
        "settled",
      ]);
    });
  });

  describe("one-off charges", () => {
    it("takes a noticed charge planned for the next weekly debit with the week's rent", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, {
        plan: "next_debit",
        weeks: null,
        isStripeReady: true,
      });
      await giveNotice(lineId);
      await runAt(new Date());
      expect((await onlyDebit(rentalId)).amountCents).toBe(RENT_CENTS + 120_00);
    });

    it("waits for the notice date, then goes with the first weekly debit on or after it", async () => {
      const { rentalId, handedOverAt } = await rentalOut();
      const lineId = await addCleaning(rentalId, {
        plan: "next_debit",
        weeks: null,
        isStripeReady: true,
      });
      await giveNotice(lineId, 1);
      await runAt(new Date());
      expect((await onlyDebit(rentalId)).amountCents).toBe(RENT_CENTS);
      // The third rent week, two weeks after the handover: the first weekly debit after the date.
      const thirdWeek = new Date(handedOverAt.getTime() + 14 * DAY_MS + HOUR_MS);
      await chargeRentFor(web.db, actor.operatorId, thirdWeek, [rentalId]);
      await runAt(thirdWeek);
      const amounts = (await debitsOf(rentalId)).map((debit) => debit.amountCents).sort();
      expect(amounts).toEqual([RENT_CENTS, RENT_CENTS + 120_00]);
    });

    it("never debits a charge whose invoice wasn't emailed: no email, no debit", async () => {
      const { rentalId } = await rentalOut();
      await addCleaning(rentalId, { plan: "next_debit", weeks: null, isStripeReady: true });
      await addCleaning(rentalId, { plan: "own_debit", weeks: null, isStripeReady: true });
      const later = new Date(Date.now() + 5 * DAY_MS);
      await runAt(later);
      expect((await onlyDebit(rentalId)).amountCents).toBe(RENT_CENTS);
    });

    it("splits a charge over weekly debits to the cent, and keeps the plan once a part is debited", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(
        rentalId,
        { plan: "split", weeks: 3, isStripeReady: true },
        100_00,
      );
      await giveNotice(lineId);
      await runAt(new Date());
      expect((await onlyDebit(rentalId)).amountCents).toBe(RENT_CENTS + 33_34);
      const items = await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select().from(debitItems).where(eq(debitItems.ledgerLineId, lineId)),
      );
      expect(items).toEqual([expect.objectContaining({ instalment: 1, amountCents: 33_34 })]);
      expect(
        await changeDebitPlan(
          web.db,
          actor,
          { rentalId, ledgerLineId: lineId },
          { plan: "not_debited", weeks: null },
        ),
      ).toBe("already_debited");
    });

    it("leaves an invoice-only charge, and drops one reversed before it is debited", async () => {
      const { rentalId } = await rentalOut();
      await addCleaning(rentalId, { plan: "not_debited", weeks: null, isStripeReady: true });
      const reversedId = await addCleaning(rentalId, {
        plan: "next_debit",
        weeks: null,
        isStripeReady: true,
      });
      await giveNotice(reversedId);
      await reverseLine(
        web.db,
        actor,
        { rentalId, lineId: reversedId },
        { note: "Not owed" },
        "2026-11-10",
      );
      await runAt(new Date());
      expect((await onlyDebit(rentalId)).amountCents).toBe(RENT_CENTS);
    });

    it('debits a "Debit on [date]" charge on its own on its date, once, never before, as the system', async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, {
        plan: "own_debit",
        weeks: null,
        isStripeReady: true,
      });
      await giveNotice(lineId, 3);
      const ownDebits = async () =>
        (await debitsOf(rentalId)).filter((debit) => debit.purpose === "one_off_debit");
      await runAt(new Date());
      await runAt(new Date(Date.now() + 2 * DAY_MS));
      expect(await ownDebits()).toEqual([]);
      const onItsDay = new Date(Date.now() + 3 * DAY_MS);
      await runAt(onItsDay);
      await runAt(onItsDay);
      const [debit, ...others] = await ownDebits();
      expect(others).toEqual([]);
      expect(debit).toMatchObject({ amountCents: 120_00, periodStartsAt: null });
      expect(madeFor(debit!.id)).toHaveLength(1);
      const [entry] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ actorType: activityLog.actorType, actorId: activityLog.actorId })
          .from(activityLog)
          .where(and(eq(activityLog.entityId, debit!.id), eq(activityLog.action, "created"))),
      );
      expect(entry).toEqual({ actorType: "system", actorId: null });
    });

    it('debits a "Debit on [date]" charge after the car is back, but not while debits are paused', async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, {
        plan: "own_debit",
        weeks: null,
        isStripeReady: true,
      });
      await giveNotice(lineId);
      await setDebitsPaused(web.db, actor, rentalId, { reason: "Talking it over" });
      await runAt(new Date());
      expect(await debitsOf(rentalId)).toEqual([]);
      await setDebitsPaused(web.db, actor, rentalId, null);
      await superuser.db.execute(
        sql`update rentals set status = 'returned', returned_at = now() where id = ${rentalId}`,
      );
      await runAt(new Date());
      expect((await debitsOf(rentalId)).map((debit) => [debit.purpose, debit.amountCents])).toEqual(
        [["one_off_debit", 120_00]],
      );
    });

    it("never debits, nor changes the plan of, a charge that was reversed", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, {
        plan: "own_debit",
        weeks: null,
        isStripeReady: true,
      });
      await giveNotice(lineId);
      await reverseLine(web.db, actor, { rentalId, lineId }, { note: "Not owed" }, "2026-11-10");
      const target = { rentalId, ledgerLineId: lineId };
      expect(
        await changeDebitPlan(web.db, actor, target, { plan: "next_debit", weeks: null }),
      ).toBe("reversed");
      await runAt(new Date());
      expect((await debitsOf(rentalId)).map((debit) => debit.purpose)).toEqual(["scheduled_debit"]);
    });

    it("counts only a charge's own parts debited, so another's debit never locks its plan", async () => {
      // Fixed in the one-off notice slice: the count read every debit item of the business.
      const debited = await rentalOut();
      const splitId = await addCleaning(
        debited.rentalId,
        { plan: "split", weeks: 3, isStripeReady: true },
        90_00,
      );
      await giveNotice(splitId);
      await runAt(new Date());
      const { rentalId, renterId } = await rentalOut();
      const lineId = await addCleaning(rentalId, {
        plan: "next_debit",
        weeks: null,
        isStripeReady: true,
      });
      const clock = { now: new Date(), timeZone: "Australia/Perth" };
      const rental = { id: rentalId, renterId, status: "active" as const, settingsSnapshot: {} };
      const state = await loadRentalDebitState(web.db, actor.operatorId, rental, clock);
      expect(state.plans.find((plan) => plan.ledgerLineId === lineId)?.partsDebited).toBe(0);
      const other = await loadRentalDebitState(
        web.db,
        actor.operatorId,
        { ...rental, id: debited.rentalId, renterId: debited.renterId },
        clock,
      );
      expect(other.plans.find((plan) => plan.ledgerLineId === splitId)?.partsDebited).toBe(1);
    });

    it("offers no weekly plan once the car is back, and none without a direct debit", async () => {
      const noDebit = await addTestRenter(web, actor);
      const { rentalId } = await rentalOut(actor, { renterId: noDebit });
      const refused = await addCharge(web.db, actor, rentalId, {
        chargeTypeId: await typeId("Cleaning"),
        amountCents: 10_00,
        description: "Cleaning",
        effectiveOn: "2026-11-09",
        collection: { plan: "own_debit", weeks: null, isStripeReady: true },
      });
      expect(refused.status).toBe("collection_not_offered");
    });
  });

  describe("tenancy and timezones", () => {
    it("never applies an event on one business's account to another's debit", async () => {
      const theirs = await rentalOut(otherActor);
      await runAt(new Date(), otherActor);
      const [their] = await debitsOf(theirs.rentalId, otherActor);
      const [made] = madeFor(their!.id);
      // A message from A's account that names B's payment in its metadata.
      const forged = stripe.signedEvent({
        id: stripeId("evt"),
        type: "v1.payment_intent.succeeded",
        accountId: (
          await withTenant(web.db, actor.operatorId, (tx) =>
            tx.execute<{ id: string }>(sql`select stripe_account_id as id from stripe_accounts`),
          )
        ).rows[0]!.id,
        objectId: made!.read.paymentIntentId,
      });
      stripe.settleDebit(made!.read.paymentIntentId, true);
      await deliver(forged);
      expect((await debitsOf(theirs.rentalId, otherActor))[0]!.status).toBe("pending");
    });

    it("describes each business's week on its own clock in one run", async () => {
      const sydney = await seedOperatorWithUser(admin, "Sydney Debits Pty Ltd");
      await withTenant(web.db, sydney.operatorId, (tx) =>
        tx
          .update(operators)
          .set({ timezone: "Australia/Sydney" })
          .where(eq(operators.id, sydney.operatorId)),
      );
      await kit.connectStripe(sydney);
      const handedOverAt = new Date(Date.now() - OUT_FOR_MS);
      const perth = await rentalOut(actor, { handedOverAt });
      const east = await rentalOut(sydney, { handedOverAt });
      await runDebitJob(depsAt(new Date()));
      const [perthDebit] = await debitsOf(perth.rentalId);
      const [eastDebit] = await debitsOf(east.rentalId, sydney);
      const weekStart = perthDebit!.periodStartsAt!;
      expect(madeFor(perthDebit!.id)[0]!.request.description).toContain(
        debitDescription({ kind: "rent", weekStartsAt: weekStart }, "", "Australia/Perth").split(
          ", ",
        )[1]!,
      );
      expect(madeFor(eastDebit!.id)[0]!.request.description).toContain(
        debitDescription({ kind: "rent", weekStartsAt: weekStart }, "", "Australia/Sydney").split(
          ", ",
        )[1]!,
      );
    });
  });

  describe("the lock order", () => {
    it("runs the debit and a cash payment one after the other in both orders, no deadlock", async () => {
      for (const isDebitFirst of [true, false]) {
        const { rentalId } = await rentalOut();
        const debit = () => runAt(new Date());
        const cash = () =>
          recordPayment(web.db, actor, rentalId, {
            amountCents: 2 * RENT_CENTS,
            method: "cash",
            reference: null,
            occurredOn: "2026-11-09",
          });
        const held = { operatorId: actor.operatorId, lockQuery: LOCK_RENTAL, id: rentalId };
        await (isDebitFirst
          ? oneAfterTheOther(superuserClient, held, debit, cash)
          : oneAfterTheOther(superuserClient, held, cash, debit));
        // Cash first leaves nothing owing, so no debit; the debit first is reserved.
        expect(await debitsOf(rentalId)).toHaveLength(isDebitFirst ? 1 : 0);
      }
    });

    it("runs the debit and Pause one after the other in both orders", async () => {
      for (const isDebitFirst of [true, false]) {
        const { rentalId } = await rentalOut();
        const debit = () => runAt(new Date());
        const pause = () => setDebitsPaused(web.db, actor, rentalId, { reason: "Arrangement" });
        const held = { operatorId: actor.operatorId, lockQuery: LOCK_RENTAL, id: rentalId };
        await (isDebitFirst
          ? oneAfterTheOther(superuserClient, held, debit, pause)
          : oneAfterTheOther(superuserClient, held, pause, debit));
        expect(await debitsOf(rentalId)).toHaveLength(isDebitFirst ? 1 : 0);
      }
    });

    it("runs the debit and a one-off charge one after the other in both orders", async () => {
      for (const isDebitFirst of [true, false]) {
        const { rentalId } = await rentalOut();
        const debit = () => runAt(new Date());
        const charge = () =>
          addCleaning(rentalId, { plan: "next_debit", weeks: null, isStripeReady: true });
        const held = { operatorId: actor.operatorId, lockQuery: LOCK_RENTAL, id: rentalId };
        await (isDebitFirst
          ? oneAfterTheOther(superuserClient, held, debit, charge)
          : oneAfterTheOther(superuserClient, held, charge, debit));
        // Either way the new charge waits for its invoice's notice (no email yet).
        expect((await onlyDebit(rentalId)).amountCents).toBe(RENT_CENTS);
      }
    });

    it("runs Stripe's message and the run's re-read one after the other in both orders", async () => {
      for (const isMessageFirst of [true, false]) {
        const { rentalId } = await rentalOut();
        const now = new Date();
        await runAt(now);
        const debit = await onlyDebit(rentalId);
        const message = stripe.settleDebit(debit.stripePaymentIntentId!, true);
        const event = () => deliver(message);
        const reread = () => runAt(new Date(now.getTime() + 8 * DAY_MS));
        const held = { operatorId: actor.operatorId, lockQuery: LOCK_RENTAL, id: rentalId };
        await (isMessageFirst
          ? oneAfterTheOther(superuserClient, held, event, reread)
          : oneAfterTheOther(superuserClient, held, reread, event));
        expect(
          (await ledgerOf(rentalId)).lines.filter((line) => line.kind === "payment"),
        ).toHaveLength(1);
      }
    });
  });
});
