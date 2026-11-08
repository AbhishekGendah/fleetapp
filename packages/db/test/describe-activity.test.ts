import { describe, expect, it } from "vitest";

import { describeActivity } from "../src/activity";

describe("a Log line in words", () => {
  it("names a record and what happened to it", () => {
    expect(describeActivity("vehicle", "status_changed")).toBe("Car status changed");
    expect(describeActivity("renter", "updated")).toBe("Renter changed");
    expect(describeActivity("organisation_driver", "created")).toBe("Driver added");
    expect(describeActivity("organisation_driver", "removed")).toBe("Driver removed");
  });

  it("says a business Renter was added as a business, never with its details", () => {
    expect(describeActivity("renter", "created", { kind: "organisation", abn: "[withheld]" })).toBe(
      "Business Renter added",
    );
    expect(describeActivity("renter", "created", { fullName: "[withheld]" })).toBe("Renter added");
  });

  it("names a file by what it is for, when its line says", () => {
    expect(describeActivity("file", "viewed", { purpose: "renter_licence_scan" })).toBe(
      "Licence scan opened",
    );
    expect(describeActivity("file", "uploaded", { purpose: "vehicle_photo" })).toBe(
      "Photo uploaded",
    );
    expect(describeActivity("file", "deleted", null)).toBe("File deleted");
    expect(describeActivity("vehicle", "updated", { purpose: "vehicle_photo" })).toBe(
      "Car changed",
    );
  });

  it("says why the nightly clean-up removed a file", () => {
    expect(
      describeActivity("file", "deleted", {
        purpose: "renter_licence_scan",
        reason: "kept_the_set_time",
        keptMonths: 12,
      }),
    ).toBe("Licence scan deleted after the set number of months");
  });
});
