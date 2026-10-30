import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  type TestConnection,
} from "./fixtures";

const CHECK_VIOLATION = "23514";

/** Renters stay within their Operator, are never deleted, and the admin app cannot see them. */
describe("Renters", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let renterBId: string;

  function renterRow(operatorId: string) {
    return { operatorId, fullName: "Sam Example", phone: "0412 345 678" };
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    const [renter] = await withTenant(web.db, operatorBId, (tx) =>
      tx.insert(schema.renters).values(renterRow(operatorBId)).returning({ id: schema.renters.id }),
    );
    renterBId = renter!.id;
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("shows an Operator none of another Operator's Renters, and cannot change them", async () => {
    const found = await withTenant(web.db, operatorAId, (tx) => tx.select().from(schema.renters));
    expect(found).toEqual([]);

    const changed = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.renters)
        .set({ status: "do_not_rent", doNotRentReason: "Not theirs to set" })
        .where(eq(schema.renters.id, renterBId))
        .returning({ id: schema.renters.id }),
    );
    expect(changed).toEqual([]);
  });

  it("cannot add a Renter to another Operator", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.insert(schema.renters).values(renterRow(operatorBId)),
      ),
    );
    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("needs a phone or email, a lower-case email, and a reason for do not rent", async () => {
    const attempts = [
      { operatorId: operatorBId, fullName: "No Contact" },
      { operatorId: operatorBId, fullName: "Shouty", email: "Sam@Example.test" },
      { ...renterRow(operatorBId), status: "do_not_rent" as const },
      { ...renterRow(operatorBId), doNotRentReason: "A reason while active" },
    ];
    for (const values of attempts) {
      const code = await postgresErrorCodeOf(
        withTenant(web.db, operatorBId, (tx) => tx.insert(schema.renters).values(values)),
      );
      expect(code).toBe(CHECK_VIOLATION);
    }
  });

  it("never lets the Operator app delete one", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorBId, (tx) => tx.delete(schema.renters)),
    );
    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("gives the admin app no access to Renters at all", async () => {
    const reading = await postgresErrorCodeOf(admin.db.select().from(schema.renters));
    expect(reading).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
    const adding = await postgresErrorCodeOf(
      admin.db.insert(schema.renters).values(renterRow(operatorBId)),
    );
    expect(adding).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });
});
