import { randomUUID } from "node:crypto";

import { addDays, todayInTimeZone } from "@fleetapp/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { AnyTransaction } from "../src/client";
import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  addTestCar,
  addTestRenter,
  connectAs,
  giveTestNotice,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  testRentalRow,
  type TestConnection,
} from "./fixtures";

const CHECK_VIOLATION = "23514";
const CHARGE_CENTS = 120_00;
const PERTH = "Australia/Perth";
/** 1:30 am Sun 2 Nov in Sydney, still 10:30 pm Sat 1 Nov in Perth. */
const PAST_MOMENT = new Date("2026-11-01T14:30:00Z");

function stripeId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

/**
 * One-off charges given notice before any debit (migration 0064, review
 * fixes 13 Nov 2026): a notice states its plan exactly and gives at least
 * the rental's notice period; any change of plan voids it; a one-off part is
 * debited only inside its current notice's window on the business's own
 * calendar, never dated ahead; notices are only added to; each business's
 * are its own (rule 1).
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
  let documentId: string;

  const asA = <Result>(work: (tx: AnyTransaction) => Promise<Result>) =>
    withTenant(web.db, operatorAId, work);
  const todayInPerth = () => todayInTimeZone(new Date(), PERTH);

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
          effectiveOn: "2026-11-01",
          ...values,
        })
        .returning({ id: schema.ledgerLines.id }),
    );
    return line!.id;
  }

  /** A charge with its plan; its plan's id. */
  async function plannedCharge(
    values: Partial<typeof schema.debitPlans.$inferInsert> = {},
  ): Promise<{ lineId: string; planId: string }> {
    const lineId = await addCharge();
    const [plan] = await asA((tx) =>
      tx
        .insert(schema.debitPlans)
        .values({
          operatorId: operatorAId,
          rentalId,
          ledgerLineId: lineId,
          plan: "own_debit",
          ...values,
        })
        .returning({ id: schema.debitPlans.id }),
    );
    return { lineId, planId: plan!.id };
  }

  /** A notice recorded as the app records it, through the rules. */
  function recordNotice(
    planId: string,
    values: Partial<typeof schema.debitNotices.$inferInsert> = {},
  ) {
    return asA(async (tx) => {
      const [plan] = await tx
        .select()
        .from(schema.debitPlans)
        .where(eq(schema.debitPlans.id, planId));
      const [notice] = await tx
        .insert(schema.debitNotices)
        .values({
          operatorId: operatorAId,
          rentalId,
          debitPlanId: planId,
          plan: plan!.plan,
          weeks: plan!.weeks,
          noticeDate: addDays(todayInPerth(), 3),
          partsBefore: 0,
          emailedAt: new Date(),
          issuedDocumentId: documentId,
          ...values,
        })
        .returning({ id: schema.debitNotices.id });
      await tx
        .update(schema.debitPlans)
        .set({ noticeId: notice!.id })
        .where(eq(schema.debitPlans.id, planId));
      return notice!.id;
    });
  }

  async function noticeIdOf(planId: string) {
    const [plan] = await asA((tx) =>
      tx
        .select({ noticeId: schema.debitPlans.noticeId })
        .from(schema.debitPlans)
        .where(eq(schema.debitPlans.id, planId)),
    );
    return plan?.noticeId ?? null;
  }

  async function oneOffDebit(requestedAt = new Date()) {
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

  const notice = (ledgerLineId: string, noticeDate: string, partsBefore = 0) =>
    giveTestNotice(superuser.db, {
      operatorId: operatorAId,
      rentalId,
      ledgerLineId,
      noticeDate,
      partsBefore,
    });

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
    // The invoice a notice's email carried (its file is not needed here).
    documentId = randomUUID();
    await superuser.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.insert(schema.issuedDocuments).values({
        id: documentId,
        operatorId: operatorAId,
        rentalId,
        kind: "invoice",
        version: 1,
        fileId: randomUUID(),
        sha256: "0".repeat(64),
      });
    });
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close(), superuser.close()]);
  });

  it("records a notice only with the full notice period and the plan as it is", async () => {
    const { planId } = await plannedCharge();
    expect(
      await postgresErrorCodeOf(
        asA((tx) =>
          tx
            .update(schema.debitPlans)
            .set({ noticeId: randomUUID() })
            .where(eq(schema.debitPlans.id, planId)),
        ),
      ),
    ).toBeDefined();
    // Two days is short of the platform minimum and the rental's 3.
    expect(
      await postgresErrorCodeOf(recordNotice(planId, { noticeDate: addDays(todayInPerth(), 2) })),
    ).toBe(CHECK_VIOLATION);
    expect(await postgresErrorCodeOf(recordNotice(planId, { plan: "next_debit" }))).toBe(
      CHECK_VIOLATION,
    );
    expect(await postgresErrorCodeOf(recordNotice(planId, { partsBefore: 1 }))).toBe(
      CHECK_VIOLATION,
    );
    const noticeId = await recordNotice(planId);
    expect(await noticeIdOf(planId)).toBe(noticeId);
    expect(
      await postgresErrorCodeOf(
        asA((tx) => tx.update(schema.debitNotices).set({ noticeDate: todayInPerth() })),
      ),
    ).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("counts the notice days from the day the email was sent, within the last hour only", async () => {
    const minutes = (count: number) => new Date(Date.now() + count * 60 * 1000);
    const { planId } = await plannedCharge();
    expect(await postgresErrorCodeOf(recordNotice(planId, { emailedAt: minutes(-120) }))).toBe(
      CHECK_VIOLATION,
    );
    expect(await postgresErrorCodeOf(recordNotice(planId, { emailedAt: minutes(10) }))).toBe(
      CHECK_VIOLATION,
    );
    // A send that crossed midnight where the business is: its date counts from the day it went.
    const sentAt = minutes(-50);
    const zone = Intl.supportedValuesOf("timeZone").find(
      (each) => todayInTimeZone(sentAt, each) !== todayInTimeZone(new Date(), each),
    )!;
    await setTimezone(zone);
    try {
      const sentDay = todayInTimeZone(sentAt, zone);
      expect(
        await postgresErrorCodeOf(
          recordNotice(planId, { emailedAt: sentAt, noticeDate: addDays(sentDay, 2) }),
        ),
      ).toBe(CHECK_VIOLATION);
      await recordNotice(planId, { emailedAt: sentAt, noticeDate: addDays(sentDay, 3) });
    } finally {
      await setTimezone(PERTH);
    }
  });

  it("reads a missing or odd notice period in the settings copy as the platform minimum", async () => {
    for (const settingsSnapshot of [{ oneOffNoticeDays: "soon" }, { oneOffNoticeDays: 1.5 }, {}]) {
      const vehicleId = await addTestCar(web.db, operatorAId);
      const [odd] = await asA((tx) =>
        tx
          .insert(schema.rentals)
          .values({
            ...testRentalRow({ operatorId: operatorAId, renterId, vehicleId }),
            settingsSnapshot,
          })
          .returning({ id: schema.rentals.id }),
      );
      const savedRentalId = rentalId;
      rentalId = odd!.id;
      try {
        const { planId } = await plannedCharge();
        expect(
          await postgresErrorCodeOf(
            recordNotice(planId, { noticeDate: addDays(todayInPerth(), 2) }),
          ),
        ).toBe(CHECK_VIOLATION);
        await recordNotice(planId);
      } finally {
        rentalId = savedRentalId;
      }
    }
  });

  it("allows a debit's time a little ahead of the database's clock, never more", async () => {
    const minutes = (count: number) => new Date(Date.now() + count * 60 * 1000);
    const { lineId } = await plannedCharge();
    await notice(lineId, todayInPerth());
    expect(await postgresErrorCodeOf(addItem(await oneOffDebit(minutes(6)), lineId))).toBe(
      CHECK_VIOLATION,
    );
    await addItem(await oneOffDebit(minutes(4)), lineId);
  });

  it("takes the rental's own longer notice period from its settings copy", async () => {
    const vehicleId = await addTestCar(web.db, operatorAId);
    const [longer] = await asA((tx) =>
      tx
        .insert(schema.rentals)
        .values({
          ...testRentalRow({ operatorId: operatorAId, renterId, vehicleId }),
          settingsSnapshot: { oneOffNoticeDays: 10 },
        })
        .returning({ id: schema.rentals.id }),
    );
    const savedRentalId = rentalId;
    rentalId = longer!.id;
    try {
      const { planId } = await plannedCharge();
      expect(await postgresErrorCodeOf(recordNotice(planId))).toBe(CHECK_VIOLATION);
      await recordNotice(planId, { noticeDate: addDays(todayInPerth(), 10) });
    } finally {
      rentalId = savedRentalId;
    }
  });

  it("voids the notice on any change of plan or weeks, even to invoice only", async () => {
    for (const change of [
      { plan: "split" as const, weeks: 2 },
      { plan: "not_debited" as const, weeks: null },
    ]) {
      const { lineId, planId } = await plannedCharge();
      await notice(lineId, todayInPerth());
      await asA((tx) =>
        tx.update(schema.debitPlans).set(change).where(eq(schema.debitPlans.id, planId)),
      );
      expect(await noticeIdOf(planId)).toBeNull();
      expect(await postgresErrorCodeOf(addItem(await oneOffDebit(), lineId))).toBe(CHECK_VIOLATION);
    }
    // A split's weeks changed: 12 to 2 voids it too.
    const { lineId, planId } = await plannedCharge({ plan: "split", weeks: 12 });
    await notice(lineId, todayInPerth());
    await asA((tx) =>
      tx.update(schema.debitPlans).set({ weeks: 2 }).where(eq(schema.debitPlans.id, planId)),
    );
    expect(await noticeIdOf(planId)).toBeNull();
  });

  it("refuses a one-off part with no notice, before its date, after it lapsed, or dated ahead", async () => {
    const unplanned = await addCharge();
    expect(await postgresErrorCodeOf(addItem(await oneOffDebit(), unplanned))).toBe(
      CHECK_VIOLATION,
    );
    const { lineId } = await plannedCharge();
    expect(await postgresErrorCodeOf(addItem(await oneOffDebit(), lineId))).toBe(CHECK_VIOLATION);
    await notice(lineId, addDays(todayInPerth(), 1));
    expect(await postgresErrorCodeOf(addItem(await oneOffDebit(), lineId))).toBe(CHECK_VIOLATION);
    const lapsed = await plannedCharge();
    await notice(lapsed.lineId, addDays(todayInPerth(), -8));
    expect(await postgresErrorCodeOf(addItem(await oneOffDebit(), lapsed.lineId))).toBe(
      CHECK_VIOLATION,
    );
    // A debit dated tomorrow can't meet a notice that comes tomorrow.
    const ahead = await plannedCharge();
    await notice(ahead.lineId, addDays(todayInPerth(), 1));
    const tomorrow = new Date(Date.now() + 26 * 60 * 60 * 1000);
    expect(await postgresErrorCodeOf(addItem(await oneOffDebit(tomorrow), ahead.lineId))).toBe(
      CHECK_VIOLATION,
    );
    // Its last day is 7 days after its date.
    const lastDay = await plannedCharge();
    await notice(lastDay.lineId, addDays(todayInPerth(), -7));
    await addItem(await oneOffDebit(), lastDay.lineId);
  });

  it("counts the debit's day on the business's own calendar", async () => {
    const { lineId } = await plannedCharge();
    await notice(lineId, "2026-11-02");
    try {
      // In Perth the debit is still Sat 1 Nov: a day early.
      await setTimezone(PERTH);
      expect(await postgresErrorCodeOf(addItem(await oneOffDebit(PAST_MOMENT), lineId))).toBe(
        CHECK_VIOLATION,
      );
      // In Sydney the same moment is Sun 2 Nov: on its day.
      await setTimezone("Australia/Sydney");
      await addItem(await oneOffDebit(PAST_MOMENT), lineId);
    } finally {
      await setTimezone(PERTH);
    }
  });

  it("debits a rent week with no notice, as before", async () => {
    const weekStartsAt = new Date("2026-11-08T01:00:00Z");
    const rentId = await addCharge({
      description: "Rent",
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
          requestedAt: new Date(),
        })
        .returning({ id: schema.payments.id }),
    );
    await addItem(payment!.id, rentId);
  });

  it("gives a split's parts a week each, and a new notice for the parts left", async () => {
    const { lineId, planId } = await plannedCharge({ plan: "split", weeks: 3 });
    await notice(lineId, addDays(todayInPerth(), -9));
    // Part 1's window ended two days ago; part 2's runs to 14 days after the date.
    expect(await postgresErrorCodeOf(addItem(await oneOffDebit(), lineId, 1))).toBe(
      CHECK_VIOLATION,
    );
    await addItem(await oneOffDebit(), lineId, 2);
    // Given again for the parts left: the plan keeps its terms, its notice moves on.
    const again = await recordNotice(planId, { partsBefore: 1 });
    expect(await noticeIdOf(planId)).toBe(again);
    expect(
      await postgresErrorCodeOf(
        asA((tx) =>
          tx
            .update(schema.debitPlans)
            .set({ plan: "own_debit", weeks: null })
            .where(eq(schema.debitPlans.id, planId)),
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("keeps a business's notices to itself", async () => {
    const { planId } = await plannedCharge();
    const noticeId = await recordNotice(planId);
    const seenByB = await withTenant(web.db, operatorBId, async (tx) => ({
      notices: (await tx.select().from(schema.debitNotices)).length,
      changed: (
        await tx
          .update(schema.debitPlans)
          .set({ noticeId: null })
          .where(eq(schema.debitPlans.id, planId))
          .returning({ id: schema.debitPlans.id })
      ).length,
    }));
    expect(seenByB).toEqual({ notices: 0, changed: 0 });
    expect(await noticeIdOf(planId)).toBe(noticeId);
    expect(
      await postgresErrorCodeOf(
        withTenant(web.db, operatorBId, (tx) =>
          tx.insert(schema.debitNotices).values({
            operatorId: operatorAId,
            rentalId,
            debitPlanId: planId,
            plan: "own_debit",
            noticeDate: addDays(todayInPerth(), 3),
            partsBefore: 0,
            emailedAt: new Date(),
            issuedDocumentId: documentId,
          }),
        ),
      ),
    ).toBeDefined();
    expect(await postgresErrorCodeOf(admin.db.select().from(schema.debitNotices))).toBe(
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    );
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
    const { rentalB, chargeId } = await asB(async (tx) => {
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
      return { rentalB: rental!.id, chargeId: line!.id };
    });
    expect(await noticesDue()).toContain(operatorBId);
    expect(await debitsDue()).not.toContain(operatorBId);
    const given = (noticeDate: string) =>
      giveTestNotice(superuser.db, {
        operatorId: operatorBId,
        rentalId: rentalB,
        ledgerLineId: chargeId,
        noticeDate,
      });
    await given(addDays(todayInPerth(), 3));
    expect(await noticesDue()).not.toContain(operatorBId);
    expect(await debitsDue()).toContain(operatorBId);
    // Lapsed: its window passed, so it needs telling again.
    await given(addDays(todayInPerth(), -8));
    expect(await noticesDue()).toContain(operatorBId);
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
