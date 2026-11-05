import { LICENCE_SIDES } from "@fleetapp/core";
import { SAMPLE_JPEG } from "@fleetapp/core/testing";
import type { TestConnection } from "@fleetapp/db/testing";

import type { ActingUser } from "../src/lib/acting-user";
import { confirmUpload, type FileDependencies } from "../src/lib/files/stored-files";
import { emptyRentalForm, parseRentalForm } from "../src/lib/rentals/rental-input";
import { createRental, type NewRentalStatus } from "../src/lib/rentals/rental-records";
import { parseLicenceForm } from "../src/lib/renters/licence-input";
import { saveLicence } from "../src/lib/renters/licence-records";
import { startLicenceScanUpload } from "../src/lib/renters/licence-scans";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { createRenter } from "../src/lib/renters/renter-records";
import type { MemoryFileStorage } from "../src/lib/storage/memory-file-storage";
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
  status: NewRentalStatus = "booked",
): Promise<{ rentalId: string; vehicleId: string }> {
  const vehicleId = await addTestCar(web, owner);
  const input = parseRentalForm(
    {
      ...emptyRentalForm({ renterId, vehicleId }),
      plannedStart: "2027-06-01T09:00",
      plannedEnd: "2027-06-29T09:00",
      dailyRateCents: "70",
      longTermWeeklyCents: "350",
      bondCents: "500",
    },
    TEST_TIME_ZONE,
  );
  const result = await createRental(web.db, owner, input.data!, status, {
    timeZone: TEST_TIME_ZONE,
    now: new Date(),
  });
  if (result.status !== "saved") {
    throw new Error(`The test rental was not saved: ${result.status}`);
  }
  return { rentalId: result.rentalId, vehicleId };
}

/**
 * A Renter with everything renting needs on file: date of birth, home
 * address, email, a full licence, and both sides of it scanned.
 */
export async function addRenterReadyToRent(
  web: TestConnection,
  deps: FileDependencies & { storage: MemoryFileStorage },
  owner: ActingUser,
  fullName = "Rory Ready",
): Promise<string> {
  const parsed = parseRenterForm(
    {
      ...emptyRenterForm(),
      fullName,
      phone: "0412345678",
      email: "rory.ready@example.test",
      dateOfBirth: "1990-04-02",
      residentialAddress: "1 Test Street, Perth WA 6000",
    },
    "2026-10-30",
  );
  const renterId = await createRenter(web.db, owner, parsed.data!);
  const licence = parseLicenceForm({
    licenceIssuedIn: "WA",
    licenceCountry: "",
    licenceNumber: `${Math.floor(Math.random() * 9_000_000) + 1_000_000}`,
    licenceClass: "C",
    licenceType: "full",
    licenceExpiresOn: "2030-05-04",
  });
  await saveLicence(web.db, owner, renterId, licence.data!);
  for (const side of LICENCE_SIDES) {
    const start = await startLicenceScanUpload(deps, owner, renterId, side, {
      contentType: "image/jpeg",
      sizeBytes: 300_000,
    });
    if (start.status !== "allowed") {
      throw new Error(`The scan was not allowed: ${start.status}`);
    }
    const permission = deps.storage.permissions.at(-1)!;
    deps.storage.receive(permission.area, permission.key, SAMPLE_JPEG);
    await confirmUpload(deps, owner, start.fileId, ["renter_licence_scan"]);
  }
  return renterId;
}
