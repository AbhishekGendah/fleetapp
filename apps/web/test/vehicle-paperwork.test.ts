import { parseListQuery } from "@fleetapp/core";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { CAR_LIST } from "../src/app/cars/car-list";
import type { ActingUser } from "../src/lib/acting-user";
import { loadOperatorSettings, saveOperatorSettings } from "../src/lib/settings/operator-settings";
import { withExpiryStatuses } from "../src/lib/vehicles/expiry-columns";
import {
  addVehicleToPolicy,
  archivePolicy,
  createPolicy,
  removeVehicleFromPolicy,
  updatePolicy,
} from "../src/lib/vehicles/insurance";
import {
  parsePolicyForm,
  parseRegoForm,
  type PolicyInput,
  type RegoInput,
} from "../src/lib/vehicles/paperwork-input";
import {
  listPoliciesToJoin,
  loadPolicy,
  loadVehiclePaperwork,
} from "../src/lib/vehicles/paperwork-queries";
import {
  addRegistration,
  archiveRegistration,
  stopDirectDebit,
} from "../src/lib/vehicles/registrations";
import { listVehiclePage } from "../src/lib/vehicles/vehicle-queries";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";

const TODAY = "2026-10-30";

const REGO_FORM = {
  state: "WA",
  termMonths: "12",
  expiresOn: "2027-10-29",
  paidOn: "",
  costCents: "$912.50",
  gstCents: "",
};

const POLICY_FORM = {
  insurer: "Example Insurance",
  policyNumber: "POL-123",
  coverType: "comprehensive",
  startsOn: "2026-10-01",
  endsOn: "2027-10-01",
  excessCents: "1,000",
  paymentFrequency: "monthly",
  costCents: "1,650.00",
  gstCents: "150",
};

function rego(changes: Partial<typeof REGO_FORM> = {}): RegoInput {
  const parsed = parseRegoForm({ ...REGO_FORM, ...changes });
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  return parsed.data;
}

function policy(changes: Partial<typeof POLICY_FORM> = {}): PolicyInput {
  const parsed = parsePolicyForm({ ...POLICY_FORM, ...changes });
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  return parsed.data;
}

describe("the rego and insurance forms' rules", () => {
  it("turns typed dollars into cents and blank GST into none", () => {
    expect(rego()).toMatchObject({ termMonths: 12, costCents: 912_50, gstCents: 0, paidOn: null });
    expect(policy()).toMatchObject({
      excessCents: 1_000_00,
      paymentFrequency: "monthly",
      costCents: 1_650_00,
      gstCents: 150_00,
    });
  });

  it("refuses GST above a tenth, a date that does not exist, and a policy ending before it starts", () => {
    expect(parseRegoForm({ ...REGO_FORM, costCents: "110", gstCents: "10.01" }).success).toBe(
      false,
    );
    expect(parseRegoForm({ ...REGO_FORM, expiresOn: "2027-02-30" }).success).toBe(false);
    expect(parsePolicyForm({ ...POLICY_FORM, endsOn: "2026-09-01" }).success).toBe(false);
  });

  it("needs a state, term, cover type and amounts", () => {
    expect(parseRegoForm({ ...REGO_FORM, state: "", termMonths: "" }).success).toBe(false);
    expect(parsePolicyForm({ ...POLICY_FORM, coverType: "", costCents: "" }).success).toBe(false);
  });
});

describe("rego, insurance and the due-soon setting", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherActor: ActingUser;

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Paperwork Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Paperwork Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("starts on 30 days' warning and keeps a change", async () => {
    expect((await loadOperatorSettings(web.db, actor.operatorId)).vehicleExpiryWarningDays).toBe(
      30,
    );

    await saveOperatorSettings(web.db, actor, { vehicleExpiryWarningDays: 14 });
    await saveOperatorSettings(web.db, actor, { vehicleExpiryWarningDays: 14 });

    expect((await loadOperatorSettings(web.db, actor.operatorId)).vehicleExpiryWarningDays).toBe(
      14,
    );
    await expect(
      saveOperatorSettings(web.db, actor, { vehicleExpiryWarningDays: 500 }),
    ).rejects.toThrow();
  });

  it("makes the latest-expiring renewal the current rego, and flags one entered out of order", async () => {
    const carId = await addTestCar(web, actor);

    expect(await addRegistration(web.db, actor, carId, rego(), TODAY)).toEqual({
      status: "added",
      warning: null,
    });
    expect(
      await addRegistration(web.db, actor, carId, rego({ expiresOn: "2026-10-29" }), TODAY),
    ).toEqual({
      status: "added",
      warning: { kind: "earlier_than_current" },
    });

    const paperwork = await loadVehiclePaperwork(web.db, actor.operatorId, carId);
    expect(paperwork.registrations.map((row) => row.expiresOn)).toEqual([
      "2027-10-29",
      "2026-10-29",
    ]);

    expect(await archiveRegistration(web.db, actor, paperwork.registrations[0]!.id)).toBe(
      "archived",
    );
    expect(await archiveRegistration(web.db, otherActor, paperwork.registrations[1]!.id)).toBe(
      "not_found",
    );
    const afterArchive = await loadVehiclePaperwork(web.db, actor.operatorId, carId);
    expect(afterArchive.registrations.map((row) => row.expiresOn)).toEqual(["2026-10-29"]);
  });

  it("refuses rego for another Operator's car", async () => {
    const carId = await addTestCar(web, actor);

    expect(await addRegistration(web.db, otherActor, carId, rego(), TODAY)).toEqual({
      status: "not_found",
    });
  });

  it("keeps a monthly direct debit running with no expiry until a fixed term replaces it", async () => {
    const listActor = await seedOperatorWithUser(admin, "Direct Debit Pty Ltd");
    const carId = await addTestCar(web, listActor);
    const monthly = rego({ termMonths: "1", expiresOn: "2027-01-01", costCents: "75" });
    expect(monthly.expiresOn).toBeNull();
    expect(parseRegoForm({ ...REGO_FORM, expiresOn: "" }).success).toBe(false);

    await addRegistration(web.db, listActor, carId, monthly, TODAY);
    const listRow = async () =>
      (await listVehiclePage(web.db, listActor.operatorId, parseListQuery(CAR_LIST, {}))).rows[0];
    expect(await listRow()).toMatchObject({ isRegoOnDirectDebit: true, regoExpiresOn: null });

    await addRegistration(web.db, listActor, carId, rego(), TODAY);
    expect(await listRow()).toMatchObject({
      isRegoOnDirectDebit: false,
      regoExpiresOn: "2027-10-29",
    });
    const paperwork = await loadVehiclePaperwork(web.db, listActor.operatorId, carId);
    const directDebit = paperwork.registrations.find((row) => row.expiresOn === null);
    expect(directDebit?.directDebitStoppedOn).toBe(TODAY);
    expect(await stopDirectDebit(web.db, listActor, directDebit!.id, TODAY)).toBe("not_found");
  });

  it("stops a direct debit on the date given, only for its own Operator", async () => {
    const carId = await addTestCar(web, actor);
    await addRegistration(web.db, actor, carId, rego({ termMonths: "1", expiresOn: "" }), TODAY);
    const [directDebit] = (await loadVehiclePaperwork(web.db, actor.operatorId, carId))
      .registrations;

    expect(await stopDirectDebit(web.db, otherActor, directDebit!.id, TODAY)).toBe("not_found");
    expect(await stopDirectDebit(web.db, actor, directDebit!.id, "2026-10-15")).toBe("stopped");
    const [stopped] = (await loadVehiclePaperwork(web.db, actor.operatorId, carId)).registrations;
    expect(stopped?.directDebitStoppedOn).toBe("2026-10-15");
  });

  it("insures one car from its page, or several on a fleet policy", async () => {
    const [carA, carB] = await Promise.all([addTestCar(web, actor), addTestCar(web, actor)]);

    const single = await createPolicy(web.db, actor, policy(), [carA]);
    const fleet = await createPolicy(web.db, actor, policy({ policyNumber: "FLEET-1" }), [
      carA,
      carB,
    ]);
    if (single.status !== "created" || fleet.status !== "created") {
      throw new Error("The policies were not created.");
    }

    const carAPolicies = await loadVehiclePaperwork(web.db, actor.operatorId, carA);
    expect(carAPolicies.policies.map((row) => row.policyNumber).sort()).toEqual([
      "FLEET-1",
      "POL-123",
    ]);
    expect((await loadPolicy(web.db, actor.operatorId, fleet.policyId))?.cars).toHaveLength(2);
  });

  it("saves nothing when a car is not the Operator's", async () => {
    const otherCar = await addTestCar(web, otherActor);

    expect(await createPolicy(web.db, actor, policy({ policyNumber: "NOPE" }), [otherCar])).toEqual(
      {
        status: "not_found",
      },
    );
  });

  it("puts a car on and takes it off a policy, offering only policies it is not on", async () => {
    const carId = await addTestCar(web, actor);
    const created = await createPolicy(web.db, actor, policy({ policyNumber: "JOIN-1" }), []);
    const policyId = created.status === "created" ? created.policyId : "";
    const offered = () => listPoliciesToJoin(web.db, actor.operatorId, carId, "2026-10-29");

    expect((await offered()).map((row) => row.id)).toContain(policyId);
    expect(await addVehicleToPolicy(web.db, actor, policyId, carId)).toMatchObject({
      status: "added",
    });
    expect(await addVehicleToPolicy(web.db, actor, policyId, carId)).toEqual({
      status: "already_on",
    });
    expect((await offered()).map((row) => row.id)).not.toContain(policyId);

    expect(await removeVehicleFromPolicy(web.db, actor, policyId, carId)).toBe("removed");
    expect(await removeVehicleFromPolicy(web.db, actor, policyId, carId)).toBe("not_found");
    expect(
      (await loadPolicy(web.db, actor.operatorId, policyId))?.otherCars.map((car) => car.id),
    ).toContain(carId);
  });

  it("never lets another Operator change or archive a policy", async () => {
    const created = await createPolicy(web.db, actor, policy({ policyNumber: "MINE" }), []);
    const policyId = created.status === "created" ? created.policyId : "";

    expect(await loadPolicy(web.db, otherActor.operatorId, policyId)).toBeNull();
    expect(await updatePolicy(web.db, otherActor, policyId, policy({ insurer: "Changed" }))).toBe(
      "not_found",
    );
    expect(await archivePolicy(web.db, otherActor, policyId)).toBe("not_found");
    expect(await updatePolicy(web.db, actor, policyId, policy({ policyNumber: "MINE" }))).toBe(
      "unchanged",
    );
  });

  it("refuses the same renewal twice and a second running direct debit, and flags a take-over", async () => {
    const carId = await addTestCar(web, actor);
    const monthly = rego({ termMonths: "1", expiresOn: "" });

    expect(await addRegistration(web.db, actor, carId, rego(), TODAY)).toMatchObject({
      status: "added",
    });
    expect(await addRegistration(web.db, actor, carId, rego(), TODAY)).toEqual({
      status: "duplicate",
    });
    // The current rego still runs to 29 Oct 2027.
    expect(await addRegistration(web.db, actor, carId, monthly, TODAY)).toEqual({
      status: "added",
      warning: { kind: "direct_debit_takes_over", currentExpiresOn: "2027-10-29" },
    });
    expect(await addRegistration(web.db, actor, carId, monthly, TODAY)).toEqual({
      status: "direct_debit_running",
    });
  });

  it("refuses the same policy number for overlapping dates, but takes its renewal", async () => {
    const policyActor = await seedOperatorWithUser(admin, "Same Policy Pty Ltd");
    const carId = await addTestCar(web, policyActor);
    const first = await createPolicy(web.db, policyActor, policy({ policyNumber: "pol-9" }), [
      carId,
    ]);
    if (first.status !== "created") {
      throw new Error("The first policy was not created.");
    }

    expect(await createPolicy(web.db, policyActor, policy({ policyNumber: "POL-9" }), [])).toEqual({
      status: "duplicate",
      policyId: first.policyId,
    });
    const renewal = await createPolicy(
      web.db,
      policyActor,
      policy({ policyNumber: "POL-9", startsOn: "2027-10-02", endsOn: "2028-10-01" }),
      [carId],
    );
    expect(renewal).toMatchObject({ status: "created", overlaps: [] });
    // Another Operator may use the same number.
    expect(
      await createPolicy(web.db, otherActor, policy({ policyNumber: "POL-9" }), []),
    ).toMatchObject({ status: "created" });
  });

  it("saves a car onto a second policy for the same dates, with a warning naming the first", async () => {
    const policyActor = await seedOperatorWithUser(admin, "Overlap Pty Ltd");
    const carId = await addTestCar(web, policyActor, { rego: "OVR1" });
    await createPolicy(web.db, policyActor, policy({ policyNumber: "A-1", insurer: "First Co" }), [
      carId,
    ]);

    const second = await createPolicy(
      web.db,
      policyActor,
      policy({ policyNumber: "B-1", insurer: "Second Co" }),
      [carId],
    );
    expect(second).toMatchObject({
      status: "created",
      overlaps: [{ rego: "OVR1", insurer: "First Co", endsOn: "2027-10-01" }],
    });
    const later = await createPolicy(
      web.db,
      policyActor,
      policy({ policyNumber: "C-1", startsOn: "2028-01-01", endsOn: "2029-01-01" }),
      [],
    );
    if (later.status !== "created") {
      throw new Error("The later policy was not created.");
    }
    expect(await addVehicleToPolicy(web.db, policyActor, later.policyId, carId)).toEqual({
      status: "added",
      overlaps: [],
    });
  });

  it("shows each car's rego and insurance expiry on the list, with due-soon badges", async () => {
    const listActor = await seedOperatorWithUser(admin, "Expiry Pty Ltd");
    const carId = await addTestCar(web, listActor);
    await addRegistration(web.db, listActor, carId, rego({ expiresOn: "2026-11-05" }), TODAY);
    await createPolicy(web.db, listActor, policy({ endsOn: "2026-10-20" }), [carId]);

    const page = await listVehiclePage(web.db, listActor.operatorId, parseListQuery(CAR_LIST, {}));
    const [row] = withExpiryStatuses(page.rows, { today: "2026-10-29", warningDays: 30 });

    expect(row).toMatchObject({
      regoExpiresOn: "2026-11-05",
      regoStatus: "due_soon",
      insuranceEndsOn: "2026-10-20",
      insuranceStatus: "expired",
    });
  });
});
