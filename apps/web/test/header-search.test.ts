import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { archiveRenter } from "../src/lib/renters/renter-records";
import { headerSearchTextSchema } from "../src/lib/search/header-search-input";
import {
  searchOperatorRecords,
  type HeaderSearchFindings,
} from "../src/lib/search/header-search-queries";
import { archiveVehicle } from "../src/lib/vehicles/vehicle-records";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { addTestRenter, bookTestRentalOn } from "./rental-fixtures";

const OWN_REGO = "HSA1234";
const OTHER_REGO = "HSB1234";
const ARCHIVED_REGO = "HSA9999";

/** What was found, as names: easy to compare, and to see what leaked. */
function namesIn(findings: HeaderSearchFindings): {
  cars: string[];
  renters: string[];
  rentals: string[];
} {
  return {
    cars: findings.cars.map((car) => car.rego),
    renters: findings.renters.map((renter) => renter.fullName),
    rentals: findings.rentals.map((rental) => `${rental.renterFullName} · ${rental.rego}`),
  };
}

/**
 * The top bar's search: cars, Renters and rentals matched as their own lists
 * match them, archived ones left out, and never anything of another business,
 * even when that business has the very same names.
 */
describe("the top bar's search", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherActor: ActingUser;

  function searchAs(owner: ActingUser, text: string): Promise<HeaderSearchFindings> {
    return searchOperatorRecords(web.db, owner.operatorId, text);
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Searched Rentals Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Searched Rentals Pty Ltd");

    const renterId = await addTestRenter(web, actor, "Quentin Searle", "0491570006");
    const vehicleId = await addTestCar(web, actor, { rego: OWN_REGO });
    await bookTestRentalOn(web, actor, { renterId, vehicleId, status: "draft" });

    const archivedRenterId = await addTestRenter(web, actor, "Quentin Archived", "0491570007");
    await archiveRenter(web.db, actor, archivedRenterId);
    await archiveVehicle(web.db, actor, await addTestCar(web, actor, { rego: ARCHIVED_REGO }));

    // The other business has a Renter by the same first name, and the same phone.
    const otherRenterId = await addTestRenter(web, otherActor, "Quentin Other", "0491570006");
    const otherVehicleId = await addTestCar(web, otherActor, { rego: OTHER_REGO });
    await bookTestRentalOn(web, otherActor, {
      renterId: otherRenterId,
      vehicleId: otherVehicleId,
      status: "draft",
    });
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("finds a Renter and their rental by part of the name, and only this business's", async () => {
    expect(namesIn(await searchAs(actor, "quen"))).toEqual({
      cars: [],
      renters: ["Quentin Searle"],
      rentals: [`Quentin Searle · ${OWN_REGO}`],
    });
    expect(namesIn(await searchAs(actor, "Searl"))).toEqual({
      cars: [],
      renters: ["Quentin Searle"],
      rentals: [`Quentin Searle · ${OWN_REGO}`],
    });
  });

  it("gives the other business only its own records for the same words", async () => {
    expect(namesIn(await searchAs(otherActor, "quen"))).toEqual({
      cars: [],
      renters: ["Quentin Other"],
      rentals: [`Quentin Other · ${OTHER_REGO}`],
    });
  });

  it("never finds another business's car by its rego", async () => {
    expect(namesIn(await searchAs(actor, OTHER_REGO))).toEqual({
      cars: [],
      renters: [],
      rentals: [],
    });
  });

  it("finds a car and its rentals by rego, with or without spaces, in any case", async () => {
    for (const typed of ["HSA1234", "hsa 1234", "hsa-1234", "a12"]) {
      const found = namesIn(await searchAs(actor, typed));
      expect(found.cars, typed).toEqual([OWN_REGO]);
      expect(found.rentals, typed).toEqual([`Quentin Searle · ${OWN_REGO}`]);
    }
  });

  it("finds a car by make or model", async () => {
    expect(namesIn(await searchAs(actor, "camry")).cars).toEqual([OWN_REGO]);
    expect(namesIn(await searchAs(actor, "toyota cam")).cars).toEqual([OWN_REGO]);
  });

  it("finds a Renter by phone, with or without spaces", async () => {
    for (const typed of ["0491570006", "0491 570 006", "570006"]) {
      expect(namesIn(await searchAs(actor, typed)).renters, typed).toEqual(["Quentin Searle"]);
    }
  });

  it("leaves out archived cars and Renters", async () => {
    expect(namesIn(await searchAs(actor, ARCHIVED_REGO)).cars).toEqual([]);
    expect(namesIn(await searchAs(actor, "archived")).renters).toEqual([]);
    expect(namesIn(await searchAs(actor, "0491570007")).renters).toEqual([]);
  });

  it("finds nothing for text that matches nothing, % and _ included", async () => {
    for (const typed of ["zzzz", "%%", "__"]) {
      expect(namesIn(await searchAs(actor, typed)), typed).toEqual({
        cars: [],
        renters: [],
        rentals: [],
      });
    }
  });

  it("refuses text under two characters before searching", () => {
    expect(headerSearchTextSchema.safeParse("q").success).toBe(false);
    expect(headerSearchTextSchema.safeParse("qu").success).toBe(true);
  });
});
