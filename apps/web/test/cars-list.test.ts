import { parseListQuery } from "@fleetapp/core";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { CAR_LIST } from "../src/app/cars/car-list";
import type { ActingUser } from "../src/lib/acting-user";
import { loadCarRentalsNow } from "../src/lib/vehicles/car-rentals-now";
import { archiveVehicle } from "../src/lib/vehicles/vehicle-records";
import { countCarsByFilter, listVehiclePage } from "../src/lib/vehicles/vehicle-queries";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";
import {
  addTestRenter,
  bookTestRental,
  bookTestRentalOn,
  recordTestHandover,
  TEST_TIME_ZONE,
} from "./rental-fixtures";

const CLOCK = { timeZone: TEST_TIME_ZONE, now: new Date("2026-11-06T02:00:00Z") };

/**
 * The Cars list (7 Nov 2026 look): its filters in plain words with their
 * counts, and who has each car now and who booked it next, never crossing
 * to another business.
 */
describe("the Cars list", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: TestConnection;
  let actor: ActingUser;
  let otherActor: ActingUser;
  let outCarId: string;
  let bookedCarId: string;
  let othersCarId: string;

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    actor = await seedOperatorWithUser(admin, "Listed Cars Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Listed Cars Pty Ltd");

    const jamie = await addTestRenter(web, actor, "Jamie Park");
    const riley = await addTestRenter(web, actor, "Riley Chen");
    const out = await bookTestRental(web, actor, jamie);
    outCarId = out.vehicleId;
    await recordTestHandover(superuser, out.rentalId, new Date("2026-10-30T01:00:00Z"));
    ({ vehicleId: bookedCarId } = await bookTestRental(web, actor, riley));
    // A later booking of the same car: the list names only the next one.
    await bookTestRentalOn(web, actor, {
      renterId: jamie,
      vehicleId: bookedCarId,
      period: { plannedStart: "2027-08-01T09:00", plannedEnd: "2027-08-29T09:00" },
    });
    await archiveVehicle(web.db, actor, await addTestCar(web, actor));

    const otto = await addTestRenter(web, otherActor, "Otto Other");
    const others = await bookTestRental(web, otherActor, otto);
    othersCarId = others.vehicleId;
    await recordTestHandover(superuser, others.rentalId, new Date("2026-10-30T01:00:00Z"));
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.close()]);
  });

  it("counts each filter: Out, Available, In the workshop and Archived", async () => {
    expect(await countCarsByFilter(web.db, actor.operatorId)).toEqual({
      all: 2,
      out: 1,
      available: 1,
      workshop: 0,
      sold: 0,
      "written-off": 0,
      archived: 1,
    });
  });

  it("filters by the plain words", async () => {
    const idsFor = async (status: string) =>
      (
        await listVehiclePage(web.db, actor.operatorId, parseListQuery(CAR_LIST, { status }))
      ).rows.map((car) => car.id);
    expect(await idsFor("out")).toEqual([outCarId]);
    expect(await idsFor("available")).toEqual([bookedCarId]);
    expect(await idsFor("workshop")).toEqual([]);
    expect(await idsFor("archived")).toHaveLength(1);
  });

  it("names who has each car since when, and the next booking only", async () => {
    const byCar = await loadCarRentalsNow(web.db, actor.operatorId, [outCarId, bookedCarId], CLOCK);
    expect(byCar.get(outCarId)).toMatchObject({
      withRenter: { renterName: "Jamie Park", handedOverAt: new Date("2026-10-30T01:00:00Z") },
      nextBooking: null,
    });
    expect(byCar.get(bookedCarId)?.withRenter).toBeNull();
    expect(byCar.get(bookedCarId)?.nextBooking).toMatchObject({ renterName: "Riley Chen" });
    expect(await loadCarRentalsNow(web.db, actor.operatorId, [], CLOCK)).toEqual(new Map());
  });

  it("never shows one business another's cars or who has them", async () => {
    const asA = await loadCarRentalsNow(web.db, actor.operatorId, [othersCarId], CLOCK);
    expect(asA.get(othersCarId)).toEqual({ withRenter: null, nextBooking: null });
    const asB = await loadCarRentalsNow(web.db, otherActor.operatorId, [othersCarId], CLOCK);
    expect(asB.get(othersCarId)?.withRenter).toMatchObject({ renterName: "Otto Other" });

    expect((await countCarsByFilter(web.db, otherActor.operatorId)).all).toBe(1);
    const page = await listVehiclePage(web.db, actor.operatorId, parseListQuery(CAR_LIST, {}));
    expect(page.rows.map((car) => car.id)).not.toContain(othersCarId);
  });
});
