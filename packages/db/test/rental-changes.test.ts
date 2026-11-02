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

/**
 * Changes of terms: each business's own, never deleted, history that only
 * moves forward, and one rate change waiting at a time.
 */
describe("rental changes", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;

  async function addRental(operatorId: string): Promise<string> {
    const [renterId, vehicleId] = await Promise.all([
      addTestRenter(web.db, operatorId),
      addTestCar(web.db, operatorId),
    ]);
    const [rental] = await withTenant(web.db, operatorId, (tx) =>
      tx
        .insert(schema.rentals)
        .values(testRentalRow({ operatorId, renterId, vehicleId }))
        .returning({ id: schema.rentals.id }),
    );
    return rental!.id;
  }

  async function userOf(operatorId: string): Promise<string> {
    const [user] = await withTenant(web.db, operatorId, (tx) =>
      tx.select({ id: schema.users.id }).from(schema.users).limit(1),
    );
    return user!.id;
  }

  async function addChange(
    operatorId: string,
    rentalId: string,
    changes: Partial<typeof schema.rentalChanges.$inferInsert> = {},
  ): Promise<string> {
    const createdByUserId = await userOf(operatorId);
    const [change] = await withTenant(web.db, operatorId, (tx) =>
      tx
        .insert(schema.rentalChanges)
        .values({
          operatorId,
          rentalId,
          kind: "weekly_rate",
          status: "waiting_for_signature",
          rateBeforeCents: 350_00,
          rateAfterCents: 380_00,
          appliesFrom: "2026-12-08",
          reason: "Yearly review",
          createdByUserId,
          ...changes,
        })
        .returning({ id: schema.rentalChanges.id }),
    );
    return change!.id;
  }

  function setStatus(
    operatorId: string,
    changeId: string,
    status: "applied" | "withdrawn" | "waiting_for_signature",
  ) {
    const now = new Date();
    return withTenant(web.db, operatorId, (tx) =>
      tx
        .update(schema.rentalChanges)
        .set({
          status,
          appliedAt: status === "applied" ? now : null,
          withdrawnAt: status === "withdrawn" ? now : null,
        })
        .where(eq(schema.rentalChanges.id, changeId)),
    );
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("holds each kind's values together, with a reason", async () => {
    const rentalId = await addRental(operatorAId);
    const endChange = {
      kind: "end_date" as const,
      status: "applied" as const,
      appliedAt: new Date(),
      rateBeforeCents: null,
      rateAfterCents: null,
      appliesFrom: null,
      typeBefore: "fixed_term" as const,
      typeAfter: "fixed_term" as const,
    };

    const endWithoutDate = await postgresErrorCodeOf(addChange(operatorAId, rentalId, endChange));
    const ongoingWithEnd = await postgresErrorCodeOf(
      addChange(operatorAId, rentalId, {
        ...endChange,
        kind: "make_ongoing",
        typeAfter: "ongoing",
        endAfter: new Date("2027-01-05T01:00:00Z"),
      }),
    );
    const rateApplyingUnsigned = await postgresErrorCodeOf(
      addChange(operatorAId, rentalId, { status: "applied", appliedAt: new Date() }),
    );
    const noReason = await postgresErrorCodeOf(addChange(operatorAId, rentalId, { reason: " " }));
    await addChange(operatorAId, rentalId, {
      ...endChange,
      endBefore: new Date("2026-12-29T01:00:00Z"),
      endAfter: new Date("2027-01-26T01:00:00Z"),
    });

    expect([endWithoutDate, ongoingWithEnd, rateApplyingUnsigned, noReason]).toEqual([
      CHECK_VIOLATION,
      CHECK_VIOLATION,
      CHECK_VIOLATION,
      CHECK_VIOLATION,
    ]);
  });

  it("keeps one rate change waiting at a time, and only moves a waiting one on", async () => {
    const rentalId = await addRental(operatorAId);
    const first = await addChange(operatorAId, rentalId);

    const second = await postgresErrorCodeOf(addChange(operatorAId, rentalId));
    await setStatus(operatorAId, first, "withdrawn");
    const backAgain = await postgresErrorCodeOf(
      setStatus(operatorAId, first, "waiting_for_signature"),
    );
    const another = await addChange(operatorAId, rentalId);
    const rewritten = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.rentalChanges)
          .set({ rateAfterCents: 999_00 })
          .where(eq(schema.rentalChanges.id, another)),
      ),
    );
    const deleted = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.delete(schema.rentalChanges).where(eq(schema.rentalChanges.id, another)),
      ),
    );

    expect(second).toBe(UNIQUE_VIOLATION);
    expect(backAgain).toBe(CHECK_VIOLATION);
    expect([rewritten, deleted]).toEqual([
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    ]);
  });

  it("keeps changes from other Operators and the admin app", async () => {
    const rentalId = await addRental(operatorAId);
    await addChange(operatorAId, rentalId);

    const seenByB = await withTenant(web.db, operatorBId, (tx) =>
      tx.select().from(schema.rentalChanges),
    );
    const onOthersRental = await postgresErrorCodeOf(addChange(operatorBId, rentalId));
    const adminCode = await postgresErrorCodeOf(admin.db.select().from(schema.rentalChanges));

    expect(seenByB).toEqual([]);
    expect(onOthersRental).toBe(FOREIGN_KEY_VIOLATION);
    expect(adminCode).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });
});
