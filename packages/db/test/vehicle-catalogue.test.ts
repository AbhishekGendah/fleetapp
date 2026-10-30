import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
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

type UnlistedRow = {
  vehicle_id: string;
  operator_id: string;
  make: string;
  model: string;
};

/** The shared car list: AGS edits it, Operators read it, and admin reaches cars only through two narrow functions. */
describe("car makes and models list", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;

  async function addCar(make: string, model: string): Promise<string> {
    const [car] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.vehicles)
        .values({
          operatorId: operatorAId,
          rego: randomUUID().slice(0, 6).toUpperCase(),
          regoState: "WA",
          make,
          model,
          year: 2023,
        })
        .returning({ id: schema.vehicles.id }),
    );
    return car!.id;
  }

  async function unlistedCars(): Promise<UnlistedRow[]> {
    const result = await admin.db.execute<UnlistedRow>(
      sql`select * from app.vehicles_not_in_catalogue()`,
    );
    return result.rows;
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId } = await seedTwoOperators(admin.db));
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("starts with the list that was built into the app", async () => {
    const rows = await web.db
      .select({ model: schema.vehicleModels.name, aliases: schema.vehicleModels.aliases })
      .from(schema.vehicleModels)
      .innerJoin(schema.vehicleMakes, eq(schema.vehicleMakes.id, schema.vehicleModels.makeId))
      .where(
        and(
          eq(schema.vehicleMakes.name, "Toyota"),
          eq(schema.vehicleModels.name, "LandCruiser Prado"),
        ),
      );
    expect(rows).toEqual([{ model: "LandCruiser Prado", aliases: ["Prado"] }]);
  });

  it("lets the Operator app read the list but never change it", async () => {
    const code = await postgresErrorCodeOf(
      web.db.insert(schema.vehicleMakes).values({ name: "Made Up" }),
    );
    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("lets the admin app add, rename and hide, but not delete", async () => {
    const [make] = await admin.db
      .insert(schema.vehicleMakes)
      .values({ name: `Testmake ${randomUUID()}` })
      .returning({ id: schema.vehicleMakes.id });
    await admin.db
      .update(schema.vehicleMakes)
      .set({ aliases: ["TM"], hiddenAt: new Date() })
      .where(eq(schema.vehicleMakes.id, make!.id));

    const duplicate = await postgresErrorCodeOf(
      admin.db.insert(schema.vehicleMakes).values({ name: "TOYOTA" }),
    );
    expect(duplicate).toBe("23505");
    const deleted = await postgresErrorCodeOf(
      admin.db.delete(schema.vehicleMakes).where(eq(schema.vehicleMakes.id, make!.id)),
    );
    expect(deleted).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("lists cars whose make or model is not in the list, and only those", async () => {
    const listed = await addCar("Toyota", "Camry");
    const typedModel = await addCar("BYD", "sea lion 6");
    const typedMake = await addCar("Trabant", "601");

    const ids = (await unlistedCars()).map((row) => row.vehicle_id);
    expect(ids).toEqual(expect.arrayContaining([typedModel, typedMake]));
    expect(ids).not.toContain(listed);
  });

  it("fixes one car's make and model and logs it in the Operator's history as an Admin's change", async () => {
    const carId = await addCar("BYD", "SEALION6");
    const adminUserId = randomUUID();

    const result = await admin.db.execute<{ fixed: boolean }>(
      sql`select app.correct_vehicle_make_model(${carId}::uuid, 'BYD', 'Sealion 6', ${adminUserId}::uuid) as fixed`,
    );
    expect(result.rows[0]?.fixed).toBe(true);

    const [car] = await withTenant(web.db, operatorAId, (tx) =>
      tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, carId)),
    );
    expect(car).toMatchObject({ make: "BYD", model: "Sealion 6" });
    const [line] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .select()
        .from(schema.activityLog)
        .where(
          and(eq(schema.activityLog.entityId, carId), eq(schema.activityLog.actorType, "admin")),
        ),
    );
    expect(line).toMatchObject({
      actorId: adminUserId,
      action: "updated",
      valuesBefore: { make: "BYD", model: "SEALION6" },
      valuesAfter: { make: "BYD", model: "Sealion 6" },
    });
    expect((await unlistedCars()).map((row) => row.vehicle_id)).not.toContain(carId);
  });

  it("refuses an empty or multi-line make or model", async () => {
    const carId = await addCar("BYD", "Seal");
    const code = await postgresErrorCodeOf(
      admin.db.execute(
        sql`select app.correct_vehicle_make_model(${carId}::uuid, 'BYD', ${"Seal\nion"}, ${randomUUID()}::uuid)`,
      ),
    );
    expect(code).toBe("22023");
  });

  it("keeps cars out of the admin app's reach otherwise, and the functions out of the Operator app's", async () => {
    expect(await postgresErrorCodeOf(admin.db.select().from(schema.vehicles))).toBe(
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    );
    expect(
      await postgresErrorCodeOf(web.db.execute(sql`select * from app.vehicles_not_in_catalogue()`)),
    ).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });
});
