import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

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
const ON_DAY = "2027-03-02";
const NEXT_WEEK = "2027-03-09";

/**
 * The ledger (rule 11): lines are only ever added; a reversal undoes one
 * line exactly; a rent period is charged once (rule 20); charge types are
 * archived, never removed; and all of it is the Operator's own, never the
 * admin app's (rule 5).
 */
describe("the ledger", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let superuser: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let renterId: string;
  let rentTypeId: string;

  async function addRental(): Promise<string> {
    const vehicleId = await addTestCar(web.db, operatorAId);
    const [rental] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.rentals)
        .values(testRentalRow({ operatorId: operatorAId, renterId, vehicleId }))
        .returning({ id: schema.rentals.id }),
    );
    return rental!.id;
  }

  function addLine(rentalId: string, values: Partial<typeof schema.ledgerLines.$inferInsert> = {}) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.ledgerLines)
        .values({
          operatorId: operatorAId,
          rentalId,
          kind: "charge",
          chargeTypeId: rentTypeId,
          amountCents: 350_00,
          gstCents: 31_82,
          description: "Weekly rent",
          effectiveOn: ON_DAY,
          ...values,
        })
        .returning({ id: schema.ledgerLines.id }),
    );
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    renterId = await addTestRenter(web.db, operatorAId);
    const [rentType] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.chargeTypes)
        .values({ operatorId: operatorAId, builtIn: "weekly_rent" })
        .returning({ id: schema.chargeTypes.id }),
    );
    rentTypeId = rentType!.id;
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close(), superuser.close()]);
  });

  it("keeps one of each built-in type, names the business's own, and never removes one", async () => {
    const secondRent = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.insert(schema.chargeTypes).values({ operatorId: operatorAId, builtIn: "weekly_rent" }),
      ),
    );
    const unnamed = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.insert(schema.chargeTypes).values({ operatorId: operatorAId, name: "  " }),
      ),
    );
    const removed = await postgresErrorCodeOf(
      superuser.db.delete(schema.chargeTypes).where(eq(schema.chargeTypes.id, rentTypeId)),
    );

    expect([secondRent, unnamed, removed]).toEqual([
      UNIQUE_VIOLATION,
      CHECK_VIOLATION,
      POSTGRES_ERROR_CODES.restrictViolation,
    ]);
  });

  it("charges a rent period once, and a credit for it once", async () => {
    const rentalId = await addRental();
    const period = { periodStart: ON_DAY, periodEnd: NEXT_WEEK };
    await addLine(rentalId, period);

    const twice = await postgresErrorCodeOf(addLine(rentalId, period));
    await addLine(rentalId, { ...period, kind: "credit", amountCents: 100_00, gstCents: 9_09 });
    const secondCredit = await postgresErrorCodeOf(
      addLine(rentalId, { ...period, kind: "credit", amountCents: 50_00, gstCents: 0 }),
    );
    await addLine(rentalId, { periodStart: NEXT_WEEK, periodEnd: "2027-03-16" });

    expect([twice, secondCredit]).toEqual([UNIQUE_VIOLATION, UNIQUE_VIOLATION]);
  });

  it("needs a method for money, a type for a charge, and GST no more than the amount", async () => {
    const rentalId = await addRental();
    const codes = [
      await postgresErrorCodeOf(addLine(rentalId, { kind: "payment", chargeTypeId: null })),
      await postgresErrorCodeOf(addLine(rentalId, { chargeTypeId: null })),
      await postgresErrorCodeOf(addLine(rentalId, { gstCents: 400_00 })),
      await postgresErrorCodeOf(addLine(rentalId, { amountCents: 0, gstCents: 0 })),
      await postgresErrorCodeOf(
        addLine(rentalId, {
          kind: "payment",
          chargeTypeId: null,
          method: "cash",
          periodStart: ON_DAY,
          periodEnd: NEXT_WEEK,
        }),
      ),
    ];
    await addLine(rentalId, { kind: "payment", chargeTypeId: null, method: "cash", gstCents: 0 });

    expect(codes).toEqual(Array(5).fill(CHECK_VIOLATION));
  });

  it("reverses a line once, exactly, and only within its own rental", async () => {
    const rentalId = await addRental();
    const otherRentalId = await addRental();
    const [charge] = await addLine(rentalId);
    const reverse = (values: Partial<typeof schema.ledgerLines.$inferInsert> = {}) =>
      addLine(rentalId, {
        kind: "reversal",
        chargeTypeId: null,
        reversesId: charge!.id,
        description: "Charged by mistake",
        ...values,
      });

    const wrongAmount = await postgresErrorCodeOf(reverse({ amountCents: 300_00 }));
    const wrongGst = await postgresErrorCodeOf(reverse({ gstCents: 0 }));
    const otherRental = await postgresErrorCodeOf(
      addLine(otherRentalId, { kind: "reversal", chargeTypeId: null, reversesId: charge!.id }),
    );
    const [reversal] = await reverse();
    const again = await postgresErrorCodeOf(reverse());
    const ofReversal = await postgresErrorCodeOf(
      addLine(rentalId, { kind: "reversal", chargeTypeId: null, reversesId: reversal!.id }),
    );

    expect([wrongAmount, wrongGst, otherRental, again, ofReversal]).toEqual([
      CHECK_VIOLATION,
      CHECK_VIOLATION,
      FOREIGN_KEY_VIOLATION,
      UNIQUE_VIOLATION,
      CHECK_VIOLATION,
    ]);
  });

  it("tells the daily rent run which businesses have a rental out, and nothing more", async () => {
    const rentalId = await addRental();
    await withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.rentals)
        .set({ status: "active", handedOverAt: new Date("2027-03-01T01:00:00Z") })
        .where(eq(schema.rentals.id, rentalId)),
    );
    const result = await web.db.execute(
      sql`SELECT * FROM app.operators_with_rent_due(${new Date().toISOString()}::timestamptz) AS operator_id`,
    );
    const operatorIds = (result.rows as { operator_id: string }[]).map((row) => row.operator_id);
    const seenByB = await withTenant(web.db, operatorBId, (tx) =>
      tx.select().from(schema.rentals).where(eq(schema.rentals.id, rentalId)),
    );

    expect(operatorIds).toContain(operatorAId);
    expect(operatorIds).not.toContain(operatorBId);
    expect(seenByB).toEqual([]);
  });

  it("never changes or removes a line, and keeps it from other Operators and the admin app", async () => {
    const rentalId = await addRental();
    const [row] = await addLine(rentalId);
    const thisRow = eq(schema.ledgerLines.id, row!.id);

    const codes = [
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.update(schema.ledgerLines).set({ amountCents: 1 }).where(thisRow),
        ),
      ),
      await postgresErrorCodeOf(
        superuser.db.update(schema.ledgerLines).set({ amountCents: 1 }).where(thisRow),
      ),
      await postgresErrorCodeOf(superuser.db.delete(schema.ledgerLines).where(thisRow)),
      await postgresErrorCodeOf(admin.db.select().from(schema.ledgerLines)),
      await postgresErrorCodeOf(admin.db.select().from(schema.chargeTypes)),
    ];
    const seenByB = await withTenant(web.db, operatorBId, (tx) =>
      tx.select().from(schema.ledgerLines).where(thisRow),
    );
    const typesSeenByB = await withTenant(web.db, operatorBId, (tx) =>
      tx.select().from(schema.chargeTypes),
    );
    const intoA = await postgresErrorCodeOf(
      withTenant(web.db, operatorBId, (tx) =>
        tx.insert(schema.ledgerLines).values({
          operatorId: operatorAId,
          rentalId,
          kind: "payment",
          method: "cash",
          amountCents: 1_00,
          gstCents: 0,
          description: "Not mine",
          effectiveOn: ON_DAY,
        }),
      ),
    );

    expect(codes).toEqual([
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.restrictViolation,
      POSTGRES_ERROR_CODES.restrictViolation,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    ]);
    expect(seenByB).toEqual([]);
    expect(typesSeenByB).toEqual([]);
    expect(intoA).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });
});
