import { randomUUID } from "node:crypto";

import {
  insurancePolicies,
  insurancePolicyVehicles,
  operators,
  users,
  vehicleRegistrations,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { TestConnection } from "@fleetapp/db/testing";
import { DIRECT_DEBIT_TERM_MONTHS, type VehicleCatalogue } from "@fleetapp/core";

import type { ActingUser } from "../src/lib/acting-user";
import {
  EMPTY_VEHICLE_FORM,
  parseNewVehicleForm,
  type VehicleFormValues,
} from "../src/lib/vehicles/vehicle-input";
import { createVehicle } from "../src/lib/vehicles/vehicle-records";

/** A small list of makes and models, so form-rule tests do not depend on what AGS lists. */
export const TEST_CATALOGUE: VehicleCatalogue = [
  {
    name: "Toyota",
    aliases: [],
    models: [
      { name: "Camry", aliases: [] },
      { name: "Corolla", aliases: [] },
      { name: "HiLux", aliases: [] },
      { name: "LandCruiser Prado", aliases: ["Prado"] },
    ],
  },
  { name: "Kia", aliases: [], models: [{ name: "Niro", aliases: [] }] },
  { name: "Mercedes-Benz", aliases: ["Merc"], models: [{ name: "C-Class", aliases: [] }] },
];

/** A new Operator with one User, seeded through the admin role as the admin app does. */
export async function seedOperatorWithUser(
  admin: TestConnection,
  name: string,
): Promise<ActingUser> {
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

/** Adds a car with a rego no other test uses: the test files share one database. */
export async function addTestCar(
  web: TestConnection,
  actor: ActingUser,
  changes: Partial<VehicleFormValues> = {},
): Promise<string> {
  const parsed = parseNewVehicleForm(
    {
      ...EMPTY_VEHICLE_FORM,
      rego: randomUUID().slice(0, 7),
      regoState: "WA",
      make: "Toyota",
      model: "Camry",
      year: "2022",
      kilometres: "12000",
      dailyRateCents: "70",
      longTermWeeklyCents: "350",
      ...changes,
    },
    new Date(),
    TEST_CATALOGUE,
  );
  if (!parsed.success) {
    throw new Error(`Test car is not valid: ${parsed.error.message}`);
  }
  const result = await createVehicle(web.db, actor, parsed.data);
  if (result.status !== "saved") {
    throw new Error("The test car was not saved.");
  }
  return result.vehicleId;
}

/** Wide enough for every date the tests hand a car over on. */
const TEST_COVER = { startsOn: "2020-01-01", endsOn: "2099-12-31" };

/**
 * Rego on a running direct debit and an insurance policy covering every test
 * date, so a handover isn't stopped for paperwork (review A8-2). No excess, so
 * contracts read as before.
 */
export async function addCurrentPaperwork(
  web: TestConnection,
  actor: ActingUser,
  vehicleId: string,
): Promise<void> {
  await withTenant(web.db, actor.operatorId, async (tx) => {
    await tx.insert(vehicleRegistrations).values({
      operatorId: actor.operatorId,
      vehicleId,
      state: "WA",
      termMonths: DIRECT_DEBIT_TERM_MONTHS,
      expiresOn: null,
      paidOn: TEST_COVER.startsOn,
      costCents: 0,
    });
    const [policy] = await tx
      .insert(insurancePolicies)
      .values({
        operatorId: actor.operatorId,
        insurer: "Test Insurer",
        policyNumber: randomUUID().slice(0, 8).toUpperCase(),
        coverType: "comprehensive",
        ...TEST_COVER,
        costCents: 0,
      })
      .returning({ id: insurancePolicies.id });
    await tx
      .insert(insurancePolicyVehicles)
      .values({ operatorId: actor.operatorId, policyId: policy!.id, vehicleId });
  });
}
