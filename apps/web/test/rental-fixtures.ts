import { LICENCE_SIDES, type BookingProblem } from "@fleetapp/core";
import { SAMPLE_JPEG } from "@fleetapp/core/testing";
import type { TestConnection } from "@fleetapp/db/testing";
import { sql } from "drizzle-orm";

import type { ActingUser } from "../src/lib/acting-user";
import { confirmUpload, type FileDependencies } from "../src/lib/files/stored-files";
import { emptyRentalForm, parseRentalForm } from "../src/lib/rentals/rental-input";
import {
  createRental,
  type BookingResult,
  type NewRentalStatus,
} from "../src/lib/rentals/rental-records";
import { parseLicenceForm } from "../src/lib/renters/licence-input";
import { saveLicence } from "../src/lib/renters/licence-records";
import { startLicenceScanUpload } from "../src/lib/renters/licence-scans";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { createRenter } from "../src/lib/renters/renter-records";
import type { MemoryFileStorage } from "../src/lib/storage/memory-file-storage";
import { addCurrentPaperwork, addTestCar } from "./car-fixtures";

export const TEST_TIME_ZONE = "Australia/Perth";

/** Adds a Renter with a name and phone only, as the Operator app does. */
export async function addTestRenter(
  web: TestConnection,
  owner: ActingUser,
  fullName = "Sam Example",
  phone = "0412345678",
): Promise<string> {
  const parsed = parseRenterForm({ ...emptyRenterForm(), fullName, phone }, "2026-10-30");
  return createRenter(web.db, owner, parsed.data!);
}

/** The test rental's dates: four weeks in June 2027, on the Operator's clock. */
export const TEST_RENTAL_PERIOD = {
  plannedStart: "2027-06-01T09:00",
  plannedEnd: "2027-06-29T09:00",
};

/** A test booking's parties and, unless the defaults do, its dates, status and clock. */
export interface TestBooking {
  renterId: string;
  vehicleId: string;
  /** No end: an ongoing rental. */
  period?: { plannedStart: string; plannedEnd: string | null };
  status?: NewRentalStatus;
  now?: Date;
}

/**
 * Tries to book this car for the Renter, $350 a week and a $500 bond, through
 * the same code as the New rental form, and says what came back.
 */
export async function attemptTestBooking(
  web: TestConnection,
  owner: ActingUser,
  booking: TestBooking,
): Promise<BookingResult> {
  const { plannedStart, plannedEnd } = booking.period ?? TEST_RENTAL_PERIOD;
  const input = parseRentalForm(
    {
      ...emptyRentalForm({ renterId: booking.renterId, vehicleId: booking.vehicleId }),
      ...(plannedEnd === null ? { type: "ongoing", plannedEnd: "" } : { plannedEnd }),
      plannedStart,
      dailyRateCents: "70",
      longTermWeeklyCents: "350",
      bondCents: "500",
    },
    TEST_TIME_ZONE,
  );
  if (!input.success) {
    throw new Error(`The test booking is not valid: ${input.error.message}`);
  }
  return createRental(web.db, owner, input.data, booking.status ?? "booked", {
    timeZone: TEST_TIME_ZONE,
    now: booking.now ?? new Date(),
  });
}

/** Books this car for the Renter as `attemptTestBooking` does; throws if it is not saved. */
export async function bookTestRentalOn(
  web: TestConnection,
  owner: ActingUser,
  booking: TestBooking,
): Promise<{ rentalId: string; vehicleId: string; problems: BookingProblem[] }> {
  const result = await attemptTestBooking(web, owner, booking);
  if (result.status !== "saved") {
    throw new Error(`The test rental was not saved: ${result.status}`);
  }
  return { rentalId: result.rentalId, vehicleId: booking.vehicleId, problems: result.problems };
}

/**
 * Books a new car for the Renter for four weeks in June 2027. The car has
 * rego and insurance on file unless asked otherwise (review A8-2).
 */
export async function bookTestRental(
  web: TestConnection,
  owner: ActingUser,
  renterId: string,
  status: NewRentalStatus = "booked",
  options: { isPaperworkOnFile?: boolean } = {},
): Promise<{ rentalId: string; vehicleId: string }> {
  const vehicleId = await addTestCar(web, owner);
  if (options.isPaperworkOnFile !== false) {
    await addCurrentPaperwork(web, owner, vehicleId);
  }
  const booked = await bookTestRentalOn(web, owner, { renterId, vehicleId, status });
  return { rentalId: booked.rentalId, vehicleId };
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

/**
 * Records a finished handover straight in the database, as the superuser:
 * the rental out, the car Out, the Renter holding it since `handedOverAt`.
 * For tests of what lists show about a rental out, as the handover itself is
 * proven in handover.test.ts.
 */
export async function recordTestHandover(
  superuser: TestConnection,
  rentalId: string,
  handedOverAt: Date,
): Promise<void> {
  const at = handedOverAt.toISOString();
  await superuser.db.execute(sql`
    with rental as (
      select r.operator_id, r.vehicle_id, r.renter_id, u.id as user_id
      from rentals r join users u on u.operator_id = r.operator_id
      where r.id = ${rentalId} limit 1
    ), inspection as (
      insert into inspections (operator_id, rental_id, vehicle_id, kind, status, photo_names,
        odometer_km, fuel_level, keys_count, started_by_user_id, acceptance_text, completed_at)
      select operator_id, ${rentalId}, vehicle_id, 'handover', 'completed', '{}', 1000, 'full', 2,
        user_id, 'Accepted in the test.', ${at}::timestamptz
      from rental
      returning id, operator_id, vehicle_id
    )
    insert into possessions (operator_id, rental_id, vehicle_id, renter_id, started_at,
      handover_inspection_id)
    select inspection.operator_id, ${rentalId}, inspection.vehicle_id, rental.renter_id,
      ${at}::timestamptz, inspection.id
    from inspection, rental`);
  await superuser.db.execute(
    sql`update rentals set status = 'active', handed_over_at = ${at}::timestamptz where id = ${rentalId}`,
  );
  await superuser.db.execute(
    sql`update vehicles set status = 'rented' from rentals
      where rentals.id = ${rentalId} and vehicles.id = rentals.vehicle_id`,
  );
}
