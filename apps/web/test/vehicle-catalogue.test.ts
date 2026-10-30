import { randomUUID } from "node:crypto";

import { vehicleMakes, vehicleModels } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { loadVehicleCatalogue } from "@fleetapp/db/vehicle-catalogue";

/** The Operator app reads the shared list AGS keeps, straight from the database. */
describe("loading the car list", () => {
  let web: TestConnection;
  let admin: TestConnection;

  beforeAll(() => {
    web = connectAs(inject("webAppRoleUrl"));
    admin = connectAs(inject("adminAppRoleUrl"));
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("has every make with its models and nicknames", async () => {
    const catalogue = await loadVehicleCatalogue(web.db);
    const toyota = catalogue.find((make) => make.name === "Toyota");

    expect(catalogue.length).toBeGreaterThan(50);
    expect(toyota?.models.map((model) => model.name)).toContain("Camry");
    expect(toyota?.models.find((model) => model.name === "LandCruiser Prado")?.aliases).toEqual([
      "Prado",
    ]);
    expect(catalogue.find((make) => make.name === "Mercedes-Benz")?.aliases).toContain("Merc");
  });

  it("leaves out what AGS has hidden, and picks up additions at once", async () => {
    const makeName = `Hidetest ${randomUUID().slice(0, 8)}`;
    const [make] = await admin.db
      .insert(vehicleMakes)
      .values({ name: makeName })
      .returning({ id: vehicleMakes.id });
    const [kept, hidden] = await admin.db
      .insert(vehicleModels)
      .values([
        { makeId: make!.id, name: "Kept" },
        { makeId: make!.id, name: "Hidden" },
      ])
      .returning({ id: vehicleModels.id });
    await admin.db
      .update(vehicleModels)
      .set({ hiddenAt: new Date() })
      .where(eq(vehicleModels.id, hidden!.id));

    const added = (await loadVehicleCatalogue(web.db)).find((entry) => entry.name === makeName);
    expect(added?.models.map((model) => model.name)).toEqual(["Kept"]);
    expect(kept).toBeDefined();

    await admin.db
      .update(vehicleMakes)
      .set({ hiddenAt: new Date() })
      .where(eq(vehicleMakes.id, make!.id));
    expect((await loadVehicleCatalogue(web.db)).some((entry) => entry.name === makeName)).toBe(
      false,
    );
  });
});
