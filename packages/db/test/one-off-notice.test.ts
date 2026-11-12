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
  postgresErrorCodeOf,
  seedTwoOperators,
  testRentalRow,
  type TestConnection,
} from "./fixtures";

const CHECK_VIOLATION = "23514";
const CHARGE_CENTS = 120_00;
/** 1:30 am Sun 15 Nov in Sydney, still 10:30 pm Sat 14 Nov in Perth. */
const DEBITED_AT = new Date("2026-11-14T14:30:00Z");

function stripeId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

/**
 * One-off charges given notice before any debit (migration 0064): a plan's
 * notice date is set once, after its invoice is emailed, and the database
 * refuses a debit of a one-off part before that day on the business's own
 * calendar, or with no notice at all. Kept to its business (rule 1).
 */
describe("one-off charge notice", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let superuser: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let renterId: string;
  let rentalId: string;
  let mandateId: string;
  let chargeTypeId: string;

  const asA = <Result>(work: (tx: AnyTransaction) => Promise<Result>) =>
    withTenant(web.db, operatorAId, work);

  async function addCharge(values: Partial<typeof schema.ledgerLines.$inferInsert> = {}) {
    const [line] = await asA((tx) =>
      tx
        .insert(schema.ledgerLines)
        .values({
          operatorId: operatorAId,
          rentalId,
          kind: "charge",
          chargeTypeId,
          amountCents: CHARGE_CENTS,
          gstCents: 0,
          description: "Cleaning",
          effectiveOn: "2026-11-12",
          ...values,
        })
        .returning({ id: schema.ledgerLines.id }),
    );
    return line!.id;
  }

  async function planFor(
    ledgerLineId: string,
    values: Partial<typeof schema.debitPlans.$inferInsert> = {},
  ) {
    await asA((tx) =>
      tx.insert(schema.debitPlans).values({
        operatorId: operatorAId,
        rentalId,
        ledgerLineId,
        plan: "own_debit",
        ...values,
      }),
    );
  }

  function setNotice(ledgerLineId: string, noticeDate: string | null) {
    return asA((tx) =>
      tx
        .update(schema.debitPlans)
        .set({ noticeDate })
        .where(eq(schema.debitPlans.ledgerLineId, ledgerLineId))
        .returning({ id: schema.debitPlans.id }),
    );
  }

  async function oneOffDebit(requestedAt = DEBITED_AT) {
    const [payment] = await asA((tx) =>
      tx
        .insert(schema.payments)
        .values({
          operatorId: operatorAId,
          renterId,
          rentalId,
          purpose: "one_off_debit",
          method: "becs_debit",
          amountCents: CHARGE_CENTS,
          status: "pending",
          mandateId,
          requestedAt,
        })
        .returning({ id: schema.payments.id }),
    );
    return payment!.id;
  }

  function addItem(paymentId: string, ledgerLineId: string, instalment = 1) {
    return asA((tx) =>
      tx.insert(schema.debitItems).values({
        operatorId: operatorAId,
        rentalId,
        paymentId,
        ledgerLineId,
        instalment,
        amountCents: CHARGE_CENTS,
      }),
    );
  }

  function setTimezone(timezone: string) {
    return superuser.db.execute(
      sql`UPDATE operators SET timezone = ${timezone} WHERE id = ${operatorAId}`,
    );
  }

  async function idsOf(query: ReturnType<typeof sql>): Promise<string[]> {
    const result = (await web.db.execute(query)) as unknown as { rows: { id: string }[] };
    return result.rows.map((row) => row.id);
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    renterId = await addTestRenter(web.db, operatorAId);
    const vehicleId = await addTestCar(web.db, operatorAId);
    const [rental] = await asA((tx) =>
      tx
        .insert(schema.rentals)
        .values(testRentalRow({ operatorId: operatorAId, renterId, vehicleId }))
        .returning({ id: schema.rentals.id }),
    );
    rentalId = rental!.id;
    const [mandate] = await asA((tx) =>
      tx
        .insert(schema.paymentMandates)
        .values({
          operatorId: operatorAId,
          renterId,
          method: "becs_debit",
          status: "active",
          stripeSetupIntentId: stripeId("seti"),
          stripePaymentMethodId: stripeId("pm"),
          stripeMandateId: stripeId("mandate"),
          setUpAt: new Date(),
        })
        .returning({ id: schema.paymentMandates.id }),
    );
    mandateId = mandate!.id;
    const [type] = await asA((tx) =>
      tx
        .insert(schema.chargeTypes)
        .values({ operatorId: operatorAId, builtIn: "cleaning" })
        .returning({ id: schema.chargeTypes.id }),
    );
    chargeTypeId = type!.id;
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close(), superuser.close()]);
  });

  it("starts a plan with no notice date, and sets it once, never changed", async () => {
    const chargeId = await addCharge();
    expect(await postgresErrorCodeOf(planFor(chargeId, { noticeDate: "2026-11-15" }))).toBe(
      CHECK_VIOLATION,
    );
    await planFor(chargeId);
    expect(await setNotice(chargeId, "2026-11-15")).toHaveLength(1);
    expect(await postgresErrorCodeOf(setNotice(chargeId, "2026-11-14"))).toBe(CHECK_VIOLATION);
    expect(await postgresErrorCodeOf(setNotice(chargeId, null))).toBe(CHECK_VIOLATION);
    // Setting it to what it is changes nothing.
    expect(await setNotice(chargeId, "2026-11-15")).toHaveLength(1);
  });

  it("refuses a one-off part with no notice, or before its notice date", async () => {
    const unplanned = await addCharge();
    expect(await postgresErrorCodeOf(addItem(await oneOffDebit(), unplanned))).toBe(
      CHECK_VIOLATION,
    );
    const chargeId = await addCharge();
    await planFor(chargeId);
    expect(await postgresErrorCodeOf(addItem(await oneOffDebit(), chargeId))).toBe(CHECK_VIOLATION);
    await setNotice(chargeId, "2026-11-16");
    expect(await postgresErrorCodeOf(addItem(await oneOffDebit(), chargeId))).toBe(CHECK_VIOLATION);
  });

  it("counts the debit's day on the business's own calendar", async () => {
    const chargeId = await addCharge();
    await planFor(chargeId);
    await setNotice(chargeId, "2026-11-15");
    try {
      // In Perth the debit is still Sat 14 Nov: a day early.
      await setTimezone("Australia/Perth");
      expect(await postgresErrorCodeOf(addItem(await oneOffDebit(), chargeId))).toBe(
        CHECK_VIOLATION,
      );
      // In Sydney the same moment is Sun 15 Nov: on its day.
      await setTimezone("Australia/Sydney");
      await addItem(await oneOffDebit(), chargeId);
    } finally {
      await setTimezone("Australia/Perth");
    }
  });

  it("debits a rent week with no plan, as before", async () => {
    const weekStartsAt = new Date("2026-11-08T01:00:00Z");
    const rentId = await addCharge({
      description: "Rent",
      amountCents: CHARGE_CENTS,
      periodStartsAt: weekStartsAt,
      periodEndsAt: new Date("2026-11-15T01:00:00Z"),
    });
    const [payment] = await asA((tx) =>
      tx
        .insert(schema.payments)
        .values({
          operatorId: operatorAId,
          renterId,
          rentalId,
          purpose: "scheduled_debit",
          method: "becs_debit",
          amountCents: CHARGE_CENTS,
          status: "pending",
          mandateId,
          periodStartsAt: weekStartsAt,
          requestedAt: DEBITED_AT,
        })
        .returning({ id: schema.payments.id }),
    );
    await addItem(payment!.id, rentId);
  });

  it("lets a split already part debited get its notice date, but never a new plan", async () => {
    const chargeId = await addCharge();
    await planFor(chargeId, { plan: "split", weeks: 3 });
    // As a split debited before the go-live: its first part already in a debit.
    await superuser.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.insert(schema.debitItems).values({
        operatorId: operatorAId,
        rentalId,
        paymentId: await oneOffDebit(),
        ledgerLineId: chargeId,
        instalment: 1,
        amountCents: 40_00,
      });
    });
    expect(await setNotice(chargeId, "2026-11-14")).toHaveLength(1);
    expect(
      await postgresErrorCodeOf(
        asA((tx) =>
          tx
            .update(schema.debitPlans)
            .set({ plan: "own_debit", weeks: null })
            .where(eq(schema.debitPlans.ledgerLineId, chargeId)),
        ),
      ),
    ).toBe(CHECK_VIOLATION);
    await addItem(await oneOffDebit(), chargeId, 2);
  });

  it("keeps a business's notice dates to itself", async () => {
    const chargeId = await addCharge();
    await planFor(chargeId);
    const changed = await withTenant(web.db, operatorBId, (tx) =>
      tx
        .update(schema.debitPlans)
        .set({ noticeDate: "2026-11-13" })
        .where(eq(schema.debitPlans.ledgerLineId, chargeId))
        .returning({ id: schema.debitPlans.id }),
    );
    expect(changed).toEqual([]);
    const [plan] = await asA((tx) =>
      tx
        .select({ noticeDate: schema.debitPlans.noticeDate })
        .from(schema.debitPlans)
        .where(eq(schema.debitPlans.ledgerLineId, chargeId)),
    );
    expect(plan?.noticeDate).toBeNull();
    const seenByB = await withTenant(web.db, operatorBId, (tx) =>
      tx.select().from(schema.debitPlans).where(eq(schema.debitPlans.ledgerLineId, chargeId)),
    );
    expect(seenByB).toEqual([]);
  });

  it("names the businesses with notices to send, and with noticed charges to debit", async () => {
    const noticesDue = () => idsOf(sql`SELECT app.operators_with_charge_notices_due() AS id`);
    const debitsDue = () => idsOf(sql`SELECT app.operators_with_debits_due() AS id`);
    const asB = <Result>(work: (tx: AnyTransaction) => Promise<Result>) =>
      withTenant(web.db, operatorBId, work);
    // Operator B: a booked rental (no car out, no debit pending) with a charge to debit.
    await superuser.db.execute(
      sql`INSERT INTO stripe_accounts (operator_id, stripe_account_id, is_live, becs_debit_payments)
          VALUES (${operatorBId}, ${stripeId("acct")}, false, 'active')`,
    );
    const renterB = await addTestRenter(web.db, operatorBId);
    const carB = await addTestCar(web.db, operatorBId);
    const chargeId = await asB(async (tx) => {
      const [rental] = await tx
        .insert(schema.rentals)
        .values(testRentalRow({ operatorId: operatorBId, renterId: renterB, vehicleId: carB }))
        .returning({ id: schema.rentals.id });
      const [type] = await tx
        .insert(schema.chargeTypes)
        .values({ operatorId: operatorBId, builtIn: "cleaning" })
        .returning({ id: schema.chargeTypes.id });
      const [line] = await tx
        .insert(schema.ledgerLines)
        .values({
          operatorId: operatorBId,
          rentalId: rental!.id,
          kind: "charge",
          chargeTypeId: type!.id,
          amountCents: CHARGE_CENTS,
          gstCents: 0,
          description: "Cleaning",
          effectiveOn: "2026-11-12",
        })
        .returning({ id: schema.ledgerLines.id });
      await tx.insert(schema.debitPlans).values({
        operatorId: operatorBId,
        rentalId: rental!.id,
        ledgerLineId: line!.id,
        plan: "own_debit",
      });
      return line!.id;
    });
    expect(await noticesDue()).toContain(operatorBId);
    expect(await debitsDue()).not.toContain(operatorBId);
    await asB((tx) =>
      tx
        .update(schema.debitPlans)
        .set({ noticeDate: "2026-11-15" })
        .where(eq(schema.debitPlans.ledgerLineId, chargeId)),
    );
    expect(await noticesDue()).not.toContain(operatorBId);
    expect(await debitsDue()).toContain(operatorBId);
    await superuser.db.execute(
      sql`UPDATE operators SET suspended_at = now() WHERE id = ${operatorBId}`,
    );
    try {
      expect(await debitsDue()).not.toContain(operatorBId);
    } finally {
      await superuser.db.execute(
        sql`UPDATE operators SET suspended_at = null WHERE id = ${operatorBId}`,
      );
    }
  });
});
