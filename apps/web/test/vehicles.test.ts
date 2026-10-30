import { randomUUID } from "node:crypto";

import { LIST_PAGE_SIZE, parseListQuery } from "@fleetapp/core";
import { missingListRules } from "@fleetapp/core";
import { activityLog, operators, users } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { CAR_LIST } from "../src/app/cars/car-list";
import { TEST_CATALOGUE } from "./car-fixtures";
import type { ActingUser } from "../src/lib/acting-user";
import { loadRecordHistory } from "../src/lib/record-history";
import { recordOdometerReading, withdrawOdometerReading } from "../src/lib/vehicles/odometer";
import {
  EMPTY_VEHICLE_FORM,
  parseVehicleForm,
  vehicleStatusInputSchema,
  parseNewVehicleForm,
  typedRego,
  type NewVehicleInput,
  type VehicleFormValues,
} from "../src/lib/vehicles/vehicle-input";
import {
  listVehiclePage,
  loadVehicle,
  VEHICLE_LIST_RULES,
} from "../src/lib/vehicles/vehicle-queries";
import {
  archiveVehicle,
  changeVehicleStatus,
  createVehicle,
  restoreVehicle,
  updateVehicle,
} from "../src/lib/vehicles/vehicle-records";

const TODAY = new Date("2026-10-29T00:00:00Z");

const CAMRY: VehicleFormValues = {
  ...EMPTY_VEHICLE_FORM,
  rego: "1abc 234",
  regoState: "WA",
  make: "toyota",
  model: "camry",
  year: "2022",
  kilometres: "12,000",
};
const FIRST_READING_KM = 12_000;

function errorFieldsFor(values: VehicleFormValues): string[] {
  const parsed = parseNewVehicleForm(values, TODAY, TEST_CATALOGUE);
  return parsed.success
    ? []
    : [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
}

function parsed(values: VehicleFormValues): NewVehicleInput {
  const result = parseNewVehicleForm(values, TODAY, TEST_CATALOGUE);
  if (!result.success) {
    throw new Error(`Test car is not valid: ${result.error.message}`);
  }
  return result.data;
}

/** A car with a rego no other test uses: the test files share one database. */
function uniqueCar(changes: Partial<VehicleFormValues> = {}): NewVehicleInput {
  return parsed({ ...CAMRY, rego: randomUUID().slice(0, 7), ...changes });
}

describe("the car form's rules", () => {
  it("stores the rego without spaces and the list's own spelling of make and model", () => {
    const car = parsed(CAMRY);

    expect(car).toMatchObject({ rego: "1ABC234", make: "Toyota", model: "Camry", year: 2022 });
  });

  it("saves a listed model in the list's spelling however it was typed, nicknames too", () => {
    expect(parsed({ ...CAMRY, model: "hi lux" })).toMatchObject({ model: "HiLux" });
    expect(parsed({ ...CAMRY, model: "prado" })).toMatchObject({ model: "LandCruiser Prado" });
    expect(parsed({ ...CAMRY, make: "merc", model: "c class" })).toMatchObject({
      make: "Mercedes-Benz",
      model: "C-Class",
    });
  });

  it("keeps a make or model not in the list exactly as typed", () => {
    const car = parsed({ ...CAMRY, make: "Trabant", model: "601" });

    expect(car).toMatchObject({ make: "Trabant", model: "601" });
  });

  it("requires rego, state, make, model, year and, for a new car, the odometer", () => {
    expect(errorFieldsFor(EMPTY_VEHICLE_FORM)).toEqual([
      "kilometres",
      "make",
      "model",
      "rego",
      "regoState",
      "year",
    ]);
    expect(parseVehicleForm({ ...CAMRY, kilometres: "" }, TODAY, TEST_CATALOGUE).success).toBe(
      true,
    );
  });

  it("types a rego in capitals, letters and numbers only, no longer than a plate", () => {
    expect(typedRego("1abc 2-3.4")).toBe("1ABC234");
    expect(typedRego("abcdefghijkl")).toBe("ABCDEFGHI");
  });

  it("refuses a bad VIN, an impossible year and silly seat counts", () => {
    expect(errorFieldsFor({ ...CAMRY, vin: "ABC", year: "2099", seats: "40" })).toEqual([
      "seats",
      "vin",
      "year",
    ]);
  });

  it("leaves the optional details blank as nothing", () => {
    const car = parsed(CAMRY);

    expect(car).toMatchObject({ vin: null, variant: null, bodyType: null, seats: null });
  });

  it("asks why and until when for in service, and clears both otherwise", () => {
    expect(
      vehicleStatusInputSchema.safeParse({
        status: "in_service",
        statusReason: "",
        statusExpectedBack: "",
      }).success,
    ).toBe(false);
    expect(
      vehicleStatusInputSchema.parse({
        status: "available",
        statusReason: "Old reason",
        statusExpectedBack: "2026-11-01",
      }),
    ).toEqual({ status: "available", statusReason: null, statusExpectedBack: null });
  });

  it("knows how to sort by every sortable column and apply every filter", () => {
    expect(
      missingListRules(CAR_LIST, {
        sortKeys: Object.keys(VEHICLE_LIST_RULES.sortBy),
        filterKeys: Object.keys(VEHICLE_LIST_RULES.filterBy),
      }),
    ).toEqual([]);
  });
});

describe("cars", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherActor: ActingUser;

  async function seedOperator(name: string): Promise<ActingUser> {
    const [operator] = await admin.db
      .insert(operators)
      .values({ legalName: name })
      .returning({ id: operators.id });
    const [user] = await admin.db
      .insert(users)
      .values({
        operatorId: operator!.id,
        email: `${randomUUID()}@example.test`,
        fullName: "Jo Citizen",
      })
      .returning({ id: users.id });
    return { userId: user!.id, operatorId: operator!.id };
  }

  async function addCar(
    changes: Partial<VehicleFormValues> = {},
    by: ActingUser = actor,
  ): Promise<string> {
    const result = await createVehicle(web.db, by, uniqueCar(changes));
    if (result.status !== "saved") {
      throw new Error("The test car was not saved.");
    }
    return result.vehicleId;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperator("Cars Pty Ltd");
    otherActor = await seedOperator("Other Cars Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("adds a car and logs it", async () => {
    const vehicleId = await addCar({ colour: "White" });

    const vehicle = await loadVehicle(web.db, actor.operatorId, vehicleId);
    expect(vehicle).toMatchObject({ make: "Toyota", colour: "White", status: "available" });
    const history = await loadRecordHistory(web.db, actor.operatorId, [
      { entityType: "vehicle", entityIds: [vehicleId] },
    ]);
    expect(history.map((entry) => [entry.action, entry.actorName])).toEqual([
      ["created", "Jo Citizen"],
    ]);
  });

  it("never shows one Operator's car to another", async () => {
    const vehicleId = await addCar();

    expect(await loadVehicle(web.db, otherActor.operatorId, vehicleId)).toBeNull();
    expect(await updateVehicle(web.db, otherActor, vehicleId, uniqueCar())).toEqual({
      status: "not_found",
    });
    expect(await archiveVehicle(web.db, otherActor, vehicleId)).toBe("not_found");
    expect(
      await recordOdometerReading(web.db, otherActor, vehicleId, {
        kilometres: 10,
        isOdometerReplaced: false,
      }),
    ).toEqual({
      status: "not_found",
    });
  });

  it("refuses the same rego twice and points to the car that has it", async () => {
    const first = uniqueCar();
    const saved = await createVehicle(web.db, actor, first);

    const second = await createVehicle(web.db, actor, { ...first, model: "Corolla" });

    expect(second).toEqual({
      status: "duplicate",
      field: "rego",
      existingVehicleId: saved.status === "saved" ? saved.vehicleId : "",
    });
  });

  it("logs only the fields an edit changed", async () => {
    const car = uniqueCar();
    const created = await createVehicle(web.db, actor, car);
    const vehicleId = created.status === "saved" ? created.vehicleId : "";

    await updateVehicle(web.db, actor, vehicleId, { ...car, model: "Corolla" });
    await updateVehicle(web.db, actor, vehicleId, { ...car, model: "Corolla" });

    const updates = await admin.db
      .select({ valuesBefore: activityLog.valuesBefore, valuesAfter: activityLog.valuesAfter })
      .from(activityLog)
      .where(and(eq(activityLog.entityId, vehicleId), eq(activityLog.action, "updated")));
    expect(updates).toEqual([
      { valuesBefore: { model: "Camry" }, valuesAfter: { model: "Corolla" } },
    ]);
  });

  it("changes status with a reason and return date", async () => {
    const vehicleId = await addCar();
    const input = vehicleStatusInputSchema.parse({
      status: "in_service",
      statusReason: "Brakes",
      statusExpectedBack: "2026-11-05",
    });

    expect(await changeVehicleStatus(web.db, actor, vehicleId, input)).toBe("changed");
    expect(await changeVehicleStatus(web.db, actor, vehicleId, input)).toBe("unchanged");
    expect(await loadVehicle(web.db, actor.operatorId, vehicleId)).toMatchObject({
      status: "in_service",
      statusReason: "Brakes",
      statusExpectedBack: "2026-11-05",
    });
  });

  it("archives a car, freeing its rego, and refuses to restore it while another car has the rego", async () => {
    const car = uniqueCar();
    const created = await createVehicle(web.db, actor, car);
    const vehicleId = created.status === "saved" ? created.vehicleId : "";

    expect(await archiveVehicle(web.db, actor, vehicleId)).toBe("changed");
    expect(await updateVehicle(web.db, actor, vehicleId, car)).toEqual({ status: "not_found" });
    const replacement = await createVehicle(web.db, actor, car);
    expect(replacement.status).toBe("saved");

    expect(await restoreVehicle(web.db, actor, vehicleId)).toMatchObject({
      status: "duplicate",
      field: "rego",
    });
  });

  it("refuses a lower reading unless the odometer was replaced, and leaves a withdrawn one out of the current km", async () => {
    const vehicleId = await addCar();

    expect((await loadVehicle(web.db, actor.operatorId, vehicleId))?.currentKilometres).toBe(
      FIRST_READING_KM,
    );
    const reading = (kilometres: number, isOdometerReplaced = false) =>
      recordOdometerReading(web.db, actor, vehicleId, { kilometres, isOdometerReplaced });
    await reading(50_000);
    expect(await reading(5_000)).toEqual({ status: "lower", lastKilometres: 50_000 });
    expect(await reading(5_000, true)).toEqual({ status: "recorded" });

    const withSlip = await loadVehicle(web.db, actor.operatorId, vehicleId);
    expect(withSlip?.currentKilometres).toBe(5_000);
    expect(withSlip?.readings.map((reading) => reading.isDrop)).toEqual([true, false, false]);

    expect(await withdrawOdometerReading(web.db, actor, withSlip!.readings[0]!.id)).toBe(
      "withdrawn",
    );
    expect(await withdrawOdometerReading(web.db, otherActor, withSlip!.readings[1]!.id)).toBe(
      "not_found",
    );
    const fixed = await loadVehicle(web.db, actor.operatorId, vehicleId);
    expect(fixed?.currentKilometres).toBe(50_000);
    expect(fixed?.readings[0]?.withdrawnAt).not.toBeNull();
  });

  describe("the list", () => {
    let listActor: ActingUser;

    beforeAll(async () => {
      listActor = await seedOperator("List Cars Pty Ltd");
      for (let index = 0; index < LIST_PAGE_SIZE; index += 1) {
        await addCar({ make: "Kia", model: "Niro" }, listActor);
      }
      await addCar({ make: "Tesla", model: "Model 3", colour: "Red" }, listActor);
      const archivedId = await addCar({ make: "Tesla", model: "Model Y" }, listActor);
      await archiveVehicle(web.db, listActor, archivedId);
    });

    const pageFor = (params: Record<string, string>) =>
      listVehiclePage(web.db, listActor.operatorId, parseListQuery(CAR_LIST, params));

    it("pages current cars only", async () => {
      const page = await pageFor({});

      expect(page).toMatchObject({ total: LIST_PAGE_SIZE + 1, pageCount: 2 });
      expect(page.rows).toHaveLength(LIST_PAGE_SIZE);
      // Each car's own first reading, not another table's row.
      expect(page.rows.every((row) => row.currentKilometres === FIRST_READING_KM)).toBe(true);
    });

    it("searches make, model and colour together", async () => {
      const page = await pageFor({ q: "tesla red" });

      expect(page.rows.map((row) => row.model)).toEqual(["Model 3"]);
    });

    it("shows archived cars only when asked", async () => {
      const page = await pageFor({ status: "archived" });

      expect(page.rows.map((row) => row.model)).toEqual(["Model Y"]);
    });
  });
});
