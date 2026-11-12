import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { AnyTransaction } from "../src/client";
import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  addTestCar,
  addTestRenter,
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  testRentalRow,
  type TestConnection,
} from "./fixtures";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const RENT_CENTS = 350_00;
const WEEK_2 = new Date("2026-11-08T01:00:00Z");

function stripeId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

/**
 * Weekly debits (migration 0063): a debit is reserved before Stripe is
 * asked, once per rental, week and attempt, on the Renter's own direct
 * debit; its amount and purpose never change and Stripe's ID is set once.
 * Plans, items and ledger links stay with their rental and business, and
 * a line Stripe's news made is never reversed by hand.
 */
describe("weekly debits", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let userId: string;
  let renterId: string;
  let otherRenterId: string;
  let rentalId: string;
  let mandateId: string;
  let otherMandateId: string;
  let chargeTypeId: string;

  const asA = <Result>(work: (tx: AnyTransaction) => Promise<Result>) =>
    withTenant(web.db, operatorAId, work);

  function addMandate(forRenterId: string) {
    return asA(async (tx) => {
      const [mandate] = await tx
        .insert(schema.paymentMandates)
        .values({
          operatorId: operatorAId,
          renterId: forRenterId,
          method: "becs_debit",
          status: "active",
          stripeSetupIntentId: stripeId("seti"),
          stripePaymentMethodId: stripeId("pm"),
          stripeMandateId: stripeId("mandate"),
          setUpAt: new Date(),
        })
        .returning({ id: schema.paymentMandates.id });
      return mandate!.id;
    });
  }

  function debitValues(
    values: Partial<typeof schema.payments.$inferInsert> = {},
  ): typeof schema.payments.$inferInsert {
    return {
      operatorId: operatorAId,
      renterId,
      rentalId,
      purpose: "scheduled_debit",
      method: "becs_debit",
      amountCents: RENT_CENTS,
      status: "pending",
      mandateId,
      periodStartsAt: WEEK_2,
      requestedAt: new Date(),
      ...values,
    };
  }

  async function reserveDebit(values: Partial<typeof schema.payments.$inferInsert> = {}) {
    const [payment] = await asA((tx) =>
      tx.insert(schema.payments).values(debitValues(values)).returning({ id: schema.payments.id }),
    );
    return payment!.id;
  }

  async function addLine(values: Partial<typeof schema.ledgerLines.$inferInsert>) {
    const [line] = await asA((tx) =>
      tx
        .insert(schema.ledgerLines)
        .values({
          operatorId: operatorAId,
          rentalId,
          kind: "charge",
          chargeTypeId,
          amountCents: RENT_CENTS,
          gstCents: 0,
          description: "A line",
          effectiveOn: "2026-11-08",
          ...values,
        })
        .returning({ id: schema.ledgerLines.id }),
    );
    return line!.id;
  }

  /** A debit Stripe says cleared, its payment line and the link between them. */
  async function settledDebit(periodStartsAt: Date) {
    const paymentId = await reserveDebit({ periodStartsAt });
    await asA((tx) =>
      tx
        .update(schema.payments)
        .set({ stripePaymentIntentId: stripeId("pi"), status: "succeeded", settledAt: new Date() })
        .where(eq(schema.payments.id, paymentId)),
    );
    const lineId = await addLine({ kind: "payment", chargeTypeId: null, method: "becs_debit" });
    await asA((tx) =>
      tx.insert(schema.paymentLedgerLines).values({
        operatorId: operatorAId,
        rentalId,
        paymentId,
        ledgerLineId: lineId,
        reason: "settled",
      }),
    );
    return { paymentId, lineId };
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    const [user] = await admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.operatorId, operatorAId));
    userId = user!.id;
    renterId = await addTestRenter(web.db, operatorAId);
    otherRenterId = await addTestRenter(web.db, operatorAId);
    const vehicleId = await addTestCar(web.db, operatorAId);
    const [rental] = await asA((tx) =>
      tx
        .insert(schema.rentals)
        .values(testRentalRow({ operatorId: operatorAId, renterId, vehicleId }))
        .returning({ id: schema.rentals.id }),
    );
    rentalId = rental!.id;
    mandateId = await addMandate(renterId);
    otherMandateId = await addMandate(otherRenterId);
    const [type] = await asA((tx) =>
      tx
        .insert(schema.chargeTypes)
        .values({ operatorId: operatorAId, builtIn: "weekly_rent" })
        .returning({ id: schema.chargeTypes.id }),
    );
    chargeTypeId = type!.id;
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("reserves one weekly debit per rental, week and attempt", async () => {
    const week = new Date("2026-11-15T01:00:00Z");
    await reserveDebit({ periodStartsAt: week });
    expect(await postgresErrorCodeOf(reserveDebit({ periodStartsAt: week }))).toBe(
      UNIQUE_VIOLATION,
    );
    // Slice 6's retry is the next attempt.
    await reserveDebit({ periodStartsAt: week, attempt: 2 });
  });

  it("debits only the Renter's own direct debit", async () => {
    expect(
      await postgresErrorCodeOf(
        reserveDebit({
          periodStartsAt: new Date("2026-11-22T01:00:00Z"),
          mandateId: otherMandateId,
        }),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("ties each purpose to its details", async () => {
    const at = new Date("2026-11-29T01:00:00Z");
    // A weekly debit names its week; a one-off one doesn't; neither has a Stripe page or takes cards.
    expect(await postgresErrorCodeOf(reserveDebit({ periodStartsAt: null }))).toBe(CHECK_VIOLATION);
    expect(
      await postgresErrorCodeOf(reserveDebit({ purpose: "one_off_debit", periodStartsAt: at })),
    ).toBe(CHECK_VIOLATION);
    expect(await postgresErrorCodeOf(reserveDebit({ periodStartsAt: at, method: "card" }))).toBe(
      CHECK_VIOLATION,
    );
    expect(
      await postgresErrorCodeOf(
        reserveDebit({ periodStartsAt: at, stripeCheckoutSessionId: stripeId("cs_test") }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(await postgresErrorCodeOf(reserveDebit({ periodStartsAt: at, mandateId: null }))).toBe(
      CHECK_VIOLATION,
    );
    // A bond still needs its Stripe page and payment, and no direct debit.
    expect(
      await postgresErrorCodeOf(
        reserveDebit({
          purpose: "bond",
          method: "card",
          periodStartsAt: null,
          mandateId: null,
          requestedAt: null,
          stripeCheckoutSessionId: null,
          stripePaymentIntentId: stripeId("pi"),
        }),
      ),
    ).toBe(CHECK_VIOLATION);
    await reserveDebit({ purpose: "one_off_debit", periodStartsAt: null });
  });

  it("keeps the amount and what it is for, and Stripe's ID once set", async () => {
    const paymentId = await reserveDebit({ periodStartsAt: new Date("2026-12-06T01:00:00Z") });
    const change = (values: Partial<typeof schema.payments.$inferInsert>) =>
      asA((tx) => tx.update(schema.payments).set(values).where(eq(schema.payments.id, paymentId)));
    // Only Stripe's answer can be written: the amount, week and attempt are not the web login's to change.
    for (const fixed of [{ amountCents: 1_00 }, { attempt: 3 }, { periodStartsAt: new Date() }]) {
      expect(await postgresErrorCodeOf(change(fixed))).toBe(
        POSTGRES_ERROR_CODES.insufficientPrivilege,
      );
    }
    // Succeeded needs Stripe's ID first.
    expect(await postgresErrorCodeOf(change({ status: "succeeded", settledAt: new Date() }))).toBe(
      CHECK_VIOLATION,
    );
    await change({ stripePaymentIntentId: stripeId("pi"), stripeFeeCents: 1_23 });
    expect(await postgresErrorCodeOf(change({ stripePaymentIntentId: stripeId("pi") }))).toBe(
      CHECK_VIOLATION,
    );
    expect(await postgresErrorCodeOf(change({ stripeFeeCents: 2_00 }))).toBe(CHECK_VIOLATION);
    await change({ status: "succeeded", settledAt: new Date() });
    expect(await postgresErrorCodeOf(change({ status: "pending", settledAt: null }))).toBe(
      CHECK_VIOLATION,
    );
  });

  it("can mark a debit never sent as failed, and only that one succeeded once Stripe says so", async () => {
    const set = (paymentId: string, values: Partial<typeof schema.payments.$inferInsert>) =>
      asA((tx) => tx.update(schema.payments).set(values).where(eq(schema.payments.id, paymentId)));
    const unsent = await reserveDebit({ periodStartsAt: new Date("2026-12-13T01:00:00Z") });
    await set(unsent, { status: "failed", failureCode: "not_sent", settledAt: new Date() });
    await set(unsent, {
      status: "succeeded",
      failureCode: null,
      stripePaymentIntentId: stripeId("pi"),
    });
    const refused = await reserveDebit({ periodStartsAt: new Date("2026-12-14T01:00:00Z") });
    await set(refused, {
      status: "failed",
      failureCode: "insufficient_funds",
      settledAt: new Date(),
    });
    expect(
      await postgresErrorCodeOf(
        set(refused, {
          status: "succeeded",
          failureCode: null,
          stripePaymentIntentId: stripeId("pi"),
        }),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("plans a one-off charge, split over 2 to 12 weeks, and keeps it once it is debited", async () => {
    const chargeId = await addLine({ description: "Cleaning" });
    const plan = (values: Partial<typeof schema.debitPlans.$inferInsert>) =>
      asA((tx) =>
        tx.insert(schema.debitPlans).values({
          operatorId: operatorAId,
          rentalId,
          ledgerLineId: chargeId,
          plan: "split",
          weeks: 3,
          chosenByUserId: userId,
          ...values,
        }),
      );
    expect(await postgresErrorCodeOf(plan({ weeks: 1 }))).toBe(CHECK_VIOLATION);
    expect(await postgresErrorCodeOf(plan({ weeks: 13 }))).toBe(CHECK_VIOLATION);
    expect(await postgresErrorCodeOf(plan({ plan: "next_debit" }))).toBe(CHECK_VIOLATION);
    await plan({});
    const changePlan = () =>
      asA((tx) =>
        tx
          .update(schema.debitPlans)
          .set({ plan: "next_debit", weeks: null })
          .where(eq(schema.debitPlans.ledgerLineId, chargeId)),
      );
    // Its invoice was emailed with the debit stated (migration 0064): it may be debited now.
    await asA((tx) =>
      tx
        .update(schema.debitPlans)
        .set({ noticeDate: "2026-01-01" })
        .where(eq(schema.debitPlans.ledgerLineId, chargeId)),
    );
    const paymentId = await reserveDebit({ periodStartsAt: new Date("2026-12-20T01:00:00Z") });
    await asA((tx) =>
      tx.insert(schema.debitItems).values({
        operatorId: operatorAId,
        rentalId,
        paymentId,
        ledgerLineId: chargeId,
        instalment: 1,
        amountCents: 33_34,
      }),
    );
    expect(await postgresErrorCodeOf(changePlan())).toBe(CHECK_VIOLATION);
  });

  it("plans only charges, and puts each part in one debit only", async () => {
    const paymentLine = await addLine({ kind: "payment", chargeTypeId: null, method: "cash" });
    expect(
      await postgresErrorCodeOf(
        asA((tx) =>
          tx.insert(schema.debitPlans).values({
            operatorId: operatorAId,
            rentalId,
            ledgerLineId: paymentLine,
            plan: "own_debit",
          }),
        ),
      ),
    ).toBe(CHECK_VIOLATION);
    const rentLine = await addLine({
      description: "Rent",
      periodStartsAt: new Date("2026-12-27T01:00:00Z"),
      periodEndsAt: new Date("2027-01-03T01:00:00Z"),
    });
    const paymentId = await reserveDebit({ periodStartsAt: new Date("2026-12-27T01:00:00Z") });
    const item = () =>
      asA((tx) =>
        tx.insert(schema.debitItems).values({
          operatorId: operatorAId,
          rentalId,
          paymentId,
          ledgerLineId: rentLine,
          instalment: 1,
          amountCents: RENT_CENTS,
        }),
      );
    await item();
    expect(await postgresErrorCodeOf(item())).toBe(UNIQUE_VIOLATION);
    expect(
      await postgresErrorCodeOf(
        asA((tx) => tx.update(schema.debitItems).set({ amountCents: 1_00 })),
      ),
    ).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("links a cleared debit to exactly one payment line of its amount", async () => {
    const { paymentId } = await settledDebit(new Date("2027-01-03T01:00:00Z"));
    const another = await addLine({ kind: "payment", chargeTypeId: null, method: "becs_debit" });
    expect(
      await postgresErrorCodeOf(
        asA((tx) =>
          tx.insert(schema.paymentLedgerLines).values({
            operatorId: operatorAId,
            rentalId,
            paymentId,
            ledgerLineId: another,
            reason: "settled",
          }),
        ),
      ),
    ).toBe(UNIQUE_VIOLATION);
    const wrongAmount = await reserveDebit({ periodStartsAt: new Date("2027-01-10T01:00:00Z") });
    await asA((tx) =>
      tx
        .update(schema.payments)
        .set({ stripePaymentIntentId: stripeId("pi"), status: "succeeded", settledAt: new Date() })
        .where(eq(schema.payments.id, wrongAmount)),
    );
    const smallLine = await addLine({
      kind: "payment",
      chargeTypeId: null,
      method: "becs_debit",
      amountCents: 1_00,
    });
    expect(
      await postgresErrorCodeOf(
        asA((tx) =>
          tx.insert(schema.paymentLedgerLines).values({
            operatorId: operatorAId,
            rentalId,
            paymentId: wrongAmount,
            ledgerLineId: smallLine,
            reason: "settled",
          }),
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("refuses a hand reversal of a line Stripe's news made, but not Stripe's own", async () => {
    const { paymentId, lineId } = await settledDebit(new Date("2027-01-17T01:00:00Z"));
    expect(
      await postgresErrorCodeOf(
        addLine({
          kind: "reversal",
          chargeTypeId: null,
          reversesId: lineId,
          description: "Mistake",
          createdByUserId: userId,
        }),
      ),
    ).toBe(CHECK_VIOLATION);
    // A refund that failed undoes the refund line Stripe's news made: by the system.
    const refundLine = await addLine({ kind: "refund", chargeTypeId: null, method: "becs_debit" });
    const refundId = stripeId("re");
    await asA((tx) =>
      tx.insert(schema.paymentLedgerLines).values({
        operatorId: operatorAId,
        rentalId,
        paymentId,
        ledgerLineId: refundLine,
        reason: "refund",
        stripeObjectId: refundId,
      }),
    );
    const undo = await addLine({
      kind: "reversal",
      chargeTypeId: null,
      reversesId: refundLine,
      description: "Refund failed",
    });
    await asA((tx) =>
      tx.insert(schema.paymentLedgerLines).values({
        operatorId: operatorAId,
        rentalId,
        paymentId,
        ledgerLineId: undo,
        reason: "refund_failed",
        stripeObjectId: refundId,
      }),
    );
  });

  it("pauses a rental's debits with a reason, set and cleared together", async () => {
    const pause = (values: Partial<typeof schema.rentals.$inferInsert>) =>
      asA((tx) => tx.update(schema.rentals).set(values).where(eq(schema.rentals.id, rentalId)));
    expect(await postgresErrorCodeOf(pause({ debitsPausedAt: new Date() }))).toBe(CHECK_VIOLATION);
    await pause({ debitsPausedAt: new Date(), debitsPausedReason: "Payment arrangement" });
    await pause({ debitsPausedAt: null, debitsPausedReason: null });
  });

  it("keeps each business's debits, plans, items and links to itself, and away from admin", async () => {
    await settledDebit(new Date("2027-01-24T01:00:00Z"));
    const counts = await withTenant(web.db, operatorBId, async (tx) => ({
      payments: (await tx.select().from(schema.payments)).length,
      plans: (await tx.select().from(schema.debitPlans)).length,
      items: (await tx.select().from(schema.debitItems)).length,
      links: (await tx.select().from(schema.paymentLedgerLines)).length,
    }));
    expect(counts).toEqual({ payments: 0, plans: 0, items: 0, links: 0 });
    const changed = await withTenant(web.db, operatorBId, (tx) =>
      tx
        .update(schema.payments)
        .set({ stripeFeeCents: 9 })
        .where(eq(schema.payments.operatorId, operatorAId))
        .returning({ id: schema.payments.id }),
    );
    expect(changed).toEqual([]);
    for (const table of [schema.debitPlans, schema.debitItems, schema.paymentLedgerLines]) {
      expect(await postgresErrorCodeOf(admin.db.select().from(table))).toBe(
        POSTGRES_ERROR_CODES.insufficientPrivilege,
      );
    }
  });

  it("names the businesses with debits due, and never a suspended one", async () => {
    const due = async () =>
      (
        (await web.db.execute(sql`SELECT app.operators_with_debits_due() AS id`)) as unknown as {
          rows: { id: string }[];
        }
      ).rows.map((row) => row.id);
    const superuser = connectAs(inject("superuserUrl"));
    try {
      for (const operatorId of [operatorAId, operatorBId]) {
        await superuser.db.execute(
          sql`INSERT INTO stripe_accounts (operator_id, stripe_account_id, is_live, becs_debit_payments)
              VALUES (${operatorId}, ${stripeId("acct")}, false, 'active')`,
        );
      }
      // Operator B: a long-term car out, as the rent run leaves one (triggers skipped to set it up).
      const renterB = await addTestRenter(web.db, operatorBId);
      const carB = await addTestCar(web.db, operatorBId);
      await superuser.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role = replica`);
        await tx.execute(
          sql`INSERT INTO rentals (operator_id, renter_id, vehicle_id, type, status, planned_start,
                charge_weekday, bond_cents, settings_snapshot, settings_version, rent_model,
                is_long_term, grace_minutes, long_term_minimum_days, handed_over_at, driver_id)
              VALUES (${operatorBId}, ${renterB}, ${carB}, 'ongoing', 'active', now() - interval '9 days',
                2, 0, '{}', 1, 'blocks', true, 60, 28, now() - interval '9 days', ${renterB})`,
        );
      });
      // A: a pending debit to recover or read again. B: a car out on a ready account.
      expect(await due()).toEqual(expect.arrayContaining([operatorAId, operatorBId]));
      await superuser.db.execute(
        sql`UPDATE operators SET suspended_at = now() WHERE id = ${operatorBId}`,
      );
      expect(await due()).toContain(operatorAId);
      expect(await due()).not.toContain(operatorBId);
    } finally {
      await superuser.close();
    }
  });
});
