import { randomUUID } from "node:crypto";

import {
  activityLog,
  adminActivityLog,
  operators,
  vehicleModels,
  vehicles,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { loadVehicleCatalogue } from "@fleetapp/db/vehicle-catalogue";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  catalogueEntryInputSchema,
  addModelsInputSchema,
} from "../src/lib/car-models/car-model-input";
import { listUnlistedCars, loadMake } from "../src/lib/car-models/car-model-queries";
import {
  addMakeAndModel,
  addModels,
  createMake,
  fixCarMakeAndModel,
  setCatalogueEntryHidden,
  updateCatalogueEntry,
} from "../src/lib/car-models/car-model-records";

const ADMIN_USER_ID = randomUUID();

/** The car list on the admin site, and fixing cars typed by Operators. */
describe("car models", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let operatorId: string;

  async function addOperatorCar(make: string, model: string): Promise<string> {
    const [car] = await withTenant(web.db, operatorId, (tx) =>
      tx
        .insert(vehicles)
        .values({
          operatorId,
          rego: randomUUID().slice(0, 6),
          regoState: "WA",
          make,
          model,
          year: 2024,
        })
        .returning({ id: vehicles.id }),
    );
    return car!.id;
  }

  beforeAll(async () => {
    admin = connectAs(inject("operatorsAdminAppRoleUrl"));
    web = connectAs(inject("operatorsWebAppRoleUrl"));
    const [operator] = await admin.db
      .insert(operators)
      .values({ legalName: "Car Models Pty Ltd", tradingName: "Quick Cars" })
      .returning({ id: operators.id });
    operatorId = operator!.id;
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("reads nicknames and models one per line", () => {
    expect(
      catalogueEntryInputSchema.parse({ name: "Mercedes-Benz", aliases: " Merc, benz,, MERC " }),
    ).toEqual({
      name: "Mercedes-Benz",
      aliases: ["Merc", "benz"],
    });
    expect(
      addModelsInputSchema.parse({ names: "Sealion 6\n\n Sealion 7 \nsealion 6" }).names,
    ).toEqual(["Sealion 6", "Sealion 7"]);
    expect(addModelsInputSchema.safeParse({ names: "  \n " }).success).toBe(false);
  });

  it("adds a make once, renames it, and logs both", async () => {
    const name = `Newmake ${randomUUID().slice(0, 6)}`;
    const created = await createMake(admin.db, ADMIN_USER_ID, { name, aliases: [] });
    if (created === "duplicate") {
      throw new Error("The make was not created.");
    }
    expect(
      await createMake(admin.db, ADMIN_USER_ID, { name: name.toUpperCase(), aliases: [] }),
    ).toBe("duplicate");

    expect(
      await updateCatalogueEntry(admin.db, ADMIN_USER_ID, "make", created.makeId, {
        name,
        aliases: ["NM"],
      }),
    ).toBe("saved");
    expect(
      await updateCatalogueEntry(admin.db, ADMIN_USER_ID, "make", created.makeId, {
        name,
        aliases: ["NM"],
      }),
    ).toBe("unchanged");

    const log = await admin.db
      .select()
      .from(adminActivityLog)
      .where(eq(adminActivityLog.entityId, created.makeId));
    expect(log.map((line) => line.action).sort()).toEqual(["created", "updated"]);
  });

  it("adds several models, skipping ones already listed however they are spelt", async () => {
    const created = await createMake(admin.db, ADMIN_USER_ID, {
      name: `Multi ${randomUUID().slice(0, 6)}`,
      aliases: [],
    });
    const makeId = created === "duplicate" ? "" : created.makeId;

    await addModels(admin.db, ADMIN_USER_ID, makeId, ["Sealion 6"]);
    const result = await addModels(admin.db, ADMIN_USER_ID, makeId, ["sea lion 6", "Sealion 7"]);

    expect(result).toEqual({ added: ["Sealion 7"], alreadyListed: ["sea lion 6"] });
    expect((await loadMake(admin.db, makeId))?.models.map((model) => model.name)).toEqual([
      "Sealion 6",
      "Sealion 7",
    ]);
  });

  it("hides a model from every Operator's suggestions, and shows it again", async () => {
    const created = await createMake(admin.db, ADMIN_USER_ID, {
      name: `Hide ${randomUUID().slice(0, 6)}`,
      aliases: [],
    });
    const makeId = created === "duplicate" ? "" : created.makeId;
    await addModels(admin.db, ADMIN_USER_ID, makeId, ["Gone"]);
    const [model] = await admin.db
      .select({ id: vehicleModels.id })
      .from(vehicleModels)
      .where(eq(vehicleModels.makeId, makeId));

    await setCatalogueEntryHidden(admin.db, ADMIN_USER_ID, "model", model!.id, true);
    const suggested = async () =>
      (await loadVehicleCatalogue(web.db)).find((make) =>
        make.models.some((entry) => entry.name === "Gone"),
      );
    expect(await suggested()).toBeUndefined();

    await setCatalogueEntryHidden(admin.db, ADMIN_USER_ID, "model", model!.id, false);
    expect(await suggested()).toBeDefined();
  });

  it("lists cars typed by Operators with the business name, fixes one, and logs it in both histories", async () => {
    const typedCar = await addOperatorCar("BYD", `Sealion ${randomUUID().slice(0, 4)}`);
    const listedCar = await addOperatorCar("Toyota", "Camry");

    const unlisted = await listUnlistedCars(admin.db);
    const line = unlisted.find((car) => car.vehicleId === typedCar);
    expect(line).toMatchObject({ operatorName: "Quick Cars", make: "BYD" });
    expect(unlisted.some((car) => car.vehicleId === listedCar)).toBe(false);

    expect(
      await fixCarMakeAndModel(admin.db, ADMIN_USER_ID, typedCar, {
        make: "BYD",
        model: "Sealion 6",
      }),
    ).toBe("fixed");
    expect((await listUnlistedCars(admin.db)).some((car) => car.vehicleId === typedCar)).toBe(
      false,
    );

    const [operatorHistory] = await withTenant(web.db, operatorId, (tx) =>
      tx
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.entityId, typedCar), eq(activityLog.actorType, "admin"))),
    );
    expect(operatorHistory?.valuesAfter).toEqual({ make: "BYD", model: "Sealion 6" });
    const [agsHistory] = await admin.db
      .select()
      .from(adminActivityLog)
      .where(
        and(
          eq(adminActivityLog.entityId, typedCar),
          eq(adminActivityLog.action, "vehicle_corrected"),
        ),
      );
    expect(agsHistory?.adminUserId).toBe(ADMIN_USER_ID);
  });

  it("adds a typed make and model to the list, reusing the make if it exists", async () => {
    const model = `Newmodel ${randomUUID().slice(0, 6)}`;
    const carId = await addOperatorCar("byd", model);

    expect(await addMakeAndModel(admin.db, ADMIN_USER_ID, { make: "byd", model })).toEqual({
      added: [model],
      alreadyListed: [],
    });
    // Saved as "byd": the list says "BYD", so the car still needs its make fixing.
    expect((await listUnlistedCars(admin.db)).some((car) => car.vehicleId === carId)).toBe(true);
    await fixCarMakeAndModel(admin.db, ADMIN_USER_ID, carId, { make: "BYD", model });
    expect((await listUnlistedCars(admin.db)).some((car) => car.vehicleId === carId)).toBe(false);
  });

  it("says when the car to fix no longer exists", async () => {
    expect(
      await fixCarMakeAndModel(admin.db, ADMIN_USER_ID, randomUUID(), {
        make: "BYD",
        model: "Seal",
      }),
    ).toBe("not_found");
  });
});
