import { eq } from "drizzle-orm";
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
const ON_DAY = "2027-03-01";

/**
 * A rental's bond account: only ever added to, corrected by reversals that
 * undo one entry exactly, never below nothing held, and kept to its
 * Operator and away from the admin app.
 */
describe("bond movements", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let superuser: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let renterId: string;

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

  function addMovement(
    rentalId: string,
    values: Partial<typeof schema.bondMovements.$inferInsert> = {},
  ) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.bondMovements)
        .values({
          operatorId: operatorAId,
          rentalId,
          kind: "received",
          amountCents: 300_00,
          method: "bank_transfer",
          occurredOn: ON_DAY,
          ...values,
        })
        .returning({ id: schema.bondMovements.id }),
    );
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    renterId = await addTestRenter(web.db, operatorAId);
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close(), superuser.close()]);
  });

  it("needs a method for money in or out, and a reason for a deduction", async () => {
    const rentalId = await addRental();

    const codes = [
      await postgresErrorCodeOf(addMovement(rentalId, { method: null })),
      await postgresErrorCodeOf(addMovement(rentalId, { amountCents: 0 })),
      await postgresErrorCodeOf(
        addMovement(rentalId, { kind: "deducted", method: null, note: null }),
      ),
    ];

    expect(codes).toEqual([CHECK_VIOLATION, CHECK_VIOLATION, CHECK_VIOLATION]);
  });

  it("reverses an entry once, for its exact amount, and only within its own rental", async () => {
    const [rentalId, otherRentalId] = [await addRental(), await addRental()];
    const [entry] = await addMovement(rentalId);
    const reversal = { kind: "reversal" as const, method: null, note: "Typed twice" };

    const wrongAmount = await postgresErrorCodeOf(
      addMovement(rentalId, { ...reversal, reversesId: entry!.id, amountCents: 1 }),
    );
    const otherRental = await postgresErrorCodeOf(
      addMovement(otherRentalId, { ...reversal, reversesId: entry!.id }),
    );
    const [undo] = await addMovement(rentalId, { ...reversal, reversesId: entry!.id });
    const twice = await postgresErrorCodeOf(
      addMovement(rentalId, { ...reversal, reversesId: entry!.id }),
    );
    const ofReversal = await postgresErrorCodeOf(
      addMovement(rentalId, { ...reversal, reversesId: undo!.id }),
    );

    expect([wrongAmount, otherRental, twice, ofReversal]).toEqual([
      CHECK_VIOLATION,
      FOREIGN_KEY_VIOLATION,
      UNIQUE_VIOLATION,
      CHECK_VIOLATION,
    ]);
  });

  it("never lets the bond held go below nothing", async () => {
    const rentalId = await addRental();
    await addMovement(rentalId, { amountCents: 100_00 });

    const tooMuchOut = await postgresErrorCodeOf(
      addMovement(rentalId, { kind: "refunded", amountCents: 100_01 }),
    );
    const allOut = await addMovement(rentalId, { kind: "refunded", amountCents: 100_00 });

    expect(tooMuchOut).toBe(CHECK_VIOLATION);
    expect(allOut).toHaveLength(1);
  });

  it("never changes or removes an entry, and keeps it from other Operators and the admin app", async () => {
    const rentalId = await addRental();
    const [row] = await addMovement(rentalId);
    const thisRow = eq(schema.bondMovements.id, row!.id);

    const codes = [
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.update(schema.bondMovements).set({ amountCents: 1 }).where(thisRow),
        ),
      ),
      await postgresErrorCodeOf(superuser.db.delete(schema.bondMovements).where(thisRow)),
      await postgresErrorCodeOf(admin.db.select().from(schema.bondMovements)),
    ];
    const seenByB = await withTenant(web.db, operatorBId, (tx) =>
      tx.select().from(schema.bondMovements).where(thisRow),
    );

    expect(codes).toEqual([
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.restrictViolation,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    ]);
    expect(seenByB).toEqual([]);
  });
});
