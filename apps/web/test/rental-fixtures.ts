import type { TestConnection } from "@fleetapp/db/testing";

import type { ActingUser } from "../src/lib/acting-user";
import { emptyRentalForm, parseRentalForm } from "../src/lib/rentals/rental-input";
import { createRental } from "../src/lib/rentals/rental-records";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { createRenter } from "../src/lib/renters/renter-records";
import { addTestCar } from "./car-fixtures";

export const TEST_TIME_ZONE = "Australia/Perth";

/** Adds a Renter with a name and phone only, as the Operator app does. */
export async function addTestRenter(
  web: TestConnection,
  owner: ActingUser,
  fullName = "Sam Example",
): Promise<string> {
  const parsed = parseRenterForm(
    { ...emptyRenterForm(), fullName, phone: "0412345678" },
    "2026-10-30",
  );
  return createRenter(web.db, owner, parsed.data!);
}

/**
 * Books a new car for the Renter for four weeks in June 2027, $350 a week
 * and a $500 bond, through the same code as the New rental form.
 */
export async function bookTestRental(
  web: TestConnection,
  owner: ActingUser,
  renterId: string,
): Promise<{ rentalId: string; vehicleId: string }> {
  const vehicleId = await addTestCar(web, owner);
  const input = parseRentalForm(
    {
      ...emptyRentalForm({ renterId, vehicleId }),
      plannedStart: "2027-06-01T09:00",
      plannedEnd: "2027-06-29T09:00",
      weeklyRateCents: "350",
      bondCents: "500",
    },
    TEST_TIME_ZONE,
  );
  const result = await createRental(web.db, owner, input.data!, "booked", {
    timeZone: TEST_TIME_ZONE,
    now: new Date(),
  });
  if (result.status !== "saved") {
    throw new Error(`The test rental was not saved: ${result.status}`);
  }
  return { rentalId: result.rentalId, vehicleId };
}
