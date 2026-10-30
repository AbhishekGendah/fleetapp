import { describe, expect, it } from "vitest";

import { describeActivity } from "../src/activity";

describe("a Log line in words", () => {
  it("names a record and what happened to it", () => {
    expect(describeActivity("vehicle", "status_changed")).toBe("Car status changed");
    expect(describeActivity("renter", "updated")).toBe("Renter changed");
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
});
