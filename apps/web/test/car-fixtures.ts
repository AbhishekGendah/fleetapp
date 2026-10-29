import { randomUUID } from "node:crypto";

import { operators, users } from "@fleetapp/db/schema";
import type { TestConnection } from "@fleetapp/db/testing";

import type { ActingUser } from "../src/lib/acting-user";
import {
  EMPTY_VEHICLE_FORM,
  parseNewVehicleForm,
  type VehicleFormValues,
} from "../src/lib/vehicles/vehicle-input";
import { createVehicle } from "../src/lib/vehicles/vehicle-records";

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
      ...changes,
    },
    new Date(),
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
