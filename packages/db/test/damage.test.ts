import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  addTestCar,
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  type TestConnection,
} from "./fixtures";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Damage records and their insurance claims: each kept to its business,
 * never deleted, one claim per record, amounts never below nothing.
 */
describe("damage records and insurance claims", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;

  function addDamage(operatorId: string, vehicleId: string, changes = {}) {
    return withTenant(web.db, operatorId, (tx) =>
      tx
        .insert(schema.damageRecords)
        .values({
          operatorId,
          vehicleId,
          foundOn: "2026-11-02",
          description: "Dent in rear door",
          ...changes,
        })
        .returning({ id: schema.damageRecords.id }),
    ).then((rows) => rows[0]!.id);
  }

  function addClaim(operatorId: string, damageRecordId: string, changes = {}) {
    return withTenant(web.db, operatorId, (tx) =>
      tx
        .insert(schema.insuranceClaims)
        .values({ operatorId, damageRecordId, insurer: "Example Mutual", ...changes })
        .returning({ id: schema.insuranceClaims.id }),
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

  it("needs a note to stop repairing, and both or neither of the outline's places", async () => {
    const carId = await addTestCar(web.db, operatorAId);
    const damageId = await addDamage(operatorAId, carId);

    const withoutNote = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.damageRecords)
          .set({ status: "not_repairing" })
          .where(eq(schema.damageRecords.id, damageId)),
      ),
    );
    const halfPlaced = await postgresErrorCodeOf(addDamage(operatorAId, carId, { x: 400 }));

    expect([withoutNote, halfPlaced]).toEqual([CHECK_VIOLATION, CHECK_VIOLATION]);
  });

  it("keeps one claim per damage, with amounts never below nothing and settled after lodged", async () => {
    const carId = await addTestCar(web.db, operatorAId);
    const damageId = await addDamage(operatorAId, carId);
    await addClaim(operatorAId, damageId, { excessCents: 1_500_00 });

    const second = await postgresErrorCodeOf(addClaim(operatorAId, damageId));
    const otherDamage = await addDamage(operatorAId, carId);
    const negative = await postgresErrorCodeOf(
      addClaim(operatorAId, otherDamage, { payoutCents: -1 }),
    );
    const settledFirst = await postgresErrorCodeOf(
      addClaim(operatorAId, otherDamage, { lodgedOn: "2026-11-02", settledOn: "2026-11-01" }),
    );

    expect([second, negative, settledFirst]).toEqual([
      UNIQUE_VIOLATION,
      CHECK_VIOLATION,
      CHECK_VIOLATION,
    ]);
  });

  it("is never deleted by the app", async () => {
    const carId = await addTestCar(web.db, operatorAId);
    const damageId = await addDamage(operatorAId, carId);
    const deleted = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.delete(schema.damageRecords).where(eq(schema.damageRecords.id, damageId)),
      ),
    );
    expect(deleted).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("keeps damage and claims from other Operators and the admin app", async () => {
    const carId = await addTestCar(web.db, operatorAId);
    const damageId = await addDamage(operatorAId, carId);
    await addClaim(operatorAId, damageId);

    const seenByB = await withTenant(web.db, operatorBId, async (tx) => [
      ...(await tx.select().from(schema.damageRecords)),
      ...(await tx.select().from(schema.insuranceClaims)),
    ]);
    // B cannot point a record at A's car, nor a claim at A's damage.
    const onOthersCar = await postgresErrorCodeOf(addDamage(operatorBId, carId));
    const onOthersDamage = await postgresErrorCodeOf(addClaim(operatorBId, damageId));
    const adminCodes = [
      await postgresErrorCodeOf(admin.db.select().from(schema.damageRecords)),
      await postgresErrorCodeOf(admin.db.select().from(schema.insuranceClaims)),
    ];

    expect(seenByB).toEqual([]);
    expect([onOthersCar, onOthersDamage]).toEqual([FOREIGN_KEY_VIOLATION, FOREIGN_KEY_VIOLATION]);
    expect(adminCodes).toEqual(adminCodes.map(() => POSTGRES_ERROR_CODES.insufficientPrivilege));
  });
});
