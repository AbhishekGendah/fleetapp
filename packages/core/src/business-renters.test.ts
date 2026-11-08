import { describe, expect, it } from "vitest";

import {
  archiveProblem,
  businessDetailsStillNeeded,
  driverToAddProblem,
  type DriverCandidate,
} from "./business-renters";
import { renterShownName } from "./renters";

describe("what a business still needs before renting", () => {
  const complete = {
    abn: "51824753556",
    contactName: "Dana Wells",
    email: "dana@example.test",
    businessAddress: "4/12 Example Road, Osborne Park WA 6017",
  };

  it("needs nothing once its details are on file", () => {
    expect(businessDetailsStillNeeded(complete)).toEqual([]);
  });

  it("lists what is missing or blank, in the form's order", () => {
    expect(businessDetailsStillNeeded({ ...complete, businessAddress: null, abn: "  " })).toEqual([
      "abn",
      "businessAddress",
    ]);
  });
});

describe("who can be added as a business's driver", () => {
  const person: DriverCandidate = {
    kind: "person",
    status: "active",
    isArchived: false,
    isRetired: false,
    isCurrentDriver: false,
  };

  it("takes a current person who isn't its driver yet", () => {
    expect(driverToAddProblem(person)).toBeNull();
  });

  it("refuses a business, a removed or archived Renter, Do not rent, and a driver twice", () => {
    expect(driverToAddProblem({ ...person, kind: "organisation" })).toBe("not_a_person");
    expect(driverToAddProblem({ ...person, isRetired: true, isArchived: true })).toBe(
      "details_removed",
    );
    expect(driverToAddProblem({ ...person, isArchived: true })).toBe("archived");
    expect(driverToAddProblem({ ...person, status: "do_not_rent" })).toBe("do_not_rent");
    expect(driverToAddProblem({ ...person, isCurrentDriver: true })).toBe("already_a_driver");
  });
});

describe("when a Renter can be archived", () => {
  it("can be once nothing is booked or out and no driver link is current", () => {
    expect(
      archiveProblem({ kind: "organisation", hasRentalUnderWay: false, currentDriverLinks: 0 }),
    ).toBeNull();
  });

  it("says a rental under way first, then the drivers or the business they drive for", () => {
    expect(
      archiveProblem({ kind: "organisation", hasRentalUnderWay: true, currentDriverLinks: 2 }),
    ).toBe("in_use");
    expect(
      archiveProblem({ kind: "organisation", hasRentalUnderWay: false, currentDriverLinks: 2 }),
    ).toBe("has_drivers");
    expect(
      archiveProblem({ kind: "person", hasRentalUnderWay: false, currentDriverLinks: 1 }),
    ).toBe("drives_for");
  });
});

describe("what a Renter is called", () => {
  it("calls a business by its trading name, else its legal name", () => {
    const business = {
      kind: "organisation" as const,
      fullName: "Acme Rideshare Pty Ltd",
      preferredName: null,
    };
    expect(renterShownName({ ...business, tradingName: "Acme Rides" })).toBe("Acme Rides");
    expect(renterShownName({ ...business, tradingName: null })).toBe("Acme Rideshare Pty Ltd");
    expect(renterShownName({ ...business, tradingName: " " })).toBe("Acme Rideshare Pty Ltd");
  });

  it("calls a person by their name, with the one they go by", () => {
    expect(
      renterShownName({
        kind: "person",
        fullName: "Sam Example",
        preferredName: "Sammy",
        tradingName: null,
      }),
    ).toBe("Sam Example (Sammy)");
  });
});
