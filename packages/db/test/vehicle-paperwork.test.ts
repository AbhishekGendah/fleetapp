import { randomUUID } from "node:crypto";

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
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

/** Rego renewals and insurance stay within their Operator; admin sees none of them. */
describe("car paperwork", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let carAId: string;
  let carBId: string;
  let policyBId: string;

  async function addCar(operatorId: string): Promise<string> {
    const [car] = await withTenant(web.db, operatorId, (tx) =>
      tx
        .insert(schema.vehicles)
        .values({
          operatorId,
          rego: randomUUID().slice(0, 6).toUpperCase(),
          regoState: "WA",
          make: "Kia",
          model: "Niro",
          year: 2023,
        })
        .returning({ id: schema.vehicles.id }),
    );
    return car!.id;
  }

  function regoRow(operatorId: string, vehicleId: string) {
    return {
      operatorId,
      vehicleId,
      state: "WA" as const,
      termMonths: 12,
      expiresOn: "2027-10-29",
      costCents: 900_00,
      gstCents: 20_00,
    };
  }

  function policyRow(operatorId: string) {
    return {
      operatorId,
      insurer: "Example Insurance",
      policyNumber: "POL-1",
      coverType: "comprehensive" as const,
      startsOn: "2026-10-01",
      endsOn: "2027-10-01",
      costCents: 1_650_00,
      gstCents: 150_00,
    };
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    carAId = await addCar(operatorAId);
    carBId = await addCar(operatorBId);
    const [policy] = await withTenant(web.db, operatorBId, (tx) =>
      tx
        .insert(schema.insurancePolicies)
        .values(policyRow(operatorBId))
        .returning({ id: schema.insurancePolicies.id }),
    );
    policyBId = policy!.id;
    await withTenant(web.db, operatorBId, (tx) =>
      tx.insert(schema.vehicleRegistrations).values(regoRow(operatorBId, carBId)),
    );
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("shows an Operator none of another Operator's rego or insurance", async () => {
    const [regos, policies] = await withTenant(web.db, operatorAId, (tx) =>
      Promise.all([
        tx.select().from(schema.vehicleRegistrations),
        tx.select().from(schema.insurancePolicies),
      ]),
    );
    expect(regos).toEqual([]);
    expect(policies).toEqual([]);
  });

  it("cannot record rego against another Operator's car, even under its own Operator", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.insert(schema.vehicleRegistrations).values(regoRow(operatorAId, carBId)),
      ),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("cannot put its car on another Operator's policy", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .insert(schema.insurancePolicyVehicles)
          .values({ operatorId: operatorAId, policyId: policyBId, vehicleId: carAId }),
      ),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("puts a car on a policy once at a time, and closes rather than deletes the link", async () => {
    const link = { operatorId: operatorBId, policyId: policyBId, vehicleId: carBId };
    const [row] = await withTenant(web.db, operatorBId, (tx) =>
      tx
        .insert(schema.insurancePolicyVehicles)
        .values(link)
        .returning({ id: schema.insurancePolicyVehicles.id }),
    );
    const twice = await postgresErrorCodeOf(
      withTenant(web.db, operatorBId, (tx) =>
        tx.insert(schema.insurancePolicyVehicles).values(link),
      ),
    );
    expect(twice).toBe(UNIQUE_VIOLATION);

    const deleted = await postgresErrorCodeOf(
      withTenant(web.db, operatorBId, (tx) =>
        tx
          .delete(schema.insurancePolicyVehicles)
          .where(eq(schema.insurancePolicyVehicles.id, row!.id)),
      ),
    );
    expect(deleted).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);

    await withTenant(web.db, operatorBId, async (tx) => {
      await tx
        .update(schema.insurancePolicyVehicles)
        .set({ removedAt: new Date() })
        .where(eq(schema.insurancePolicyVehicles.id, row!.id));
      await tx.insert(schema.insurancePolicyVehicles).values(link);
    });
  });

  it("refuses GST above a tenth, a term that is not 3, 6 or 12 months, and a policy ending before it starts", async () => {
    const attempts = [
      () =>
        withTenant(web.db, operatorBId, (tx) =>
          tx
            .insert(schema.vehicleRegistrations)
            .values({ ...regoRow(operatorBId, carBId), gstCents: 90_00 }),
        ),
      () =>
        withTenant(web.db, operatorBId, (tx) =>
          tx
            .insert(schema.vehicleRegistrations)
            .values({ ...regoRow(operatorBId, carBId), termMonths: 9 }),
        ),
      () =>
        withTenant(web.db, operatorBId, (tx) =>
          tx
            .insert(schema.insurancePolicies)
            .values({ ...policyRow(operatorBId), endsOn: "2026-09-01" }),
        ),
    ];
    for (const attempt of attempts) {
      expect(await postgresErrorCodeOf(attempt())).toBe(CHECK_VIOLATION);
    }
  });

  it("gives the admin app no access to rego or insurance", async () => {
    for (const table of [
      schema.vehicleRegistrations,
      schema.insurancePolicies,
      schema.insurancePolicyVehicles,
    ]) {
      const code = await postgresErrorCodeOf(admin.db.select().from(table));
      expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
    }
  });
});
