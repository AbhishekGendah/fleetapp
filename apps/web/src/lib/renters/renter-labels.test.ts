import { WITHHELD_VALUE } from "@fleetapp/core";
import { describe, expect, it } from "vitest";

import { businessRenterFieldLabel, describeRenterValue, renterFieldLabel } from "./renter-labels";

const LINK_ID = "0b6f4c1e-3a52-4e3f-9d36-1f0e6a8b2c71";

describe("a Renter's Log fields in words", () => {
  it("names a business's kind and a driver link's two sides, not their stored keys", () => {
    for (const label of [renterFieldLabel, businessRenterFieldLabel]) {
      expect(label("kind")).toBe("Kind");
      expect(label("organisationId")).toBe("Business");
      expect(label("driverId")).toBe("Driver");
    }
    expect(businessRenterFieldLabel("fullName")).toBe("Legal name");
    expect(renterFieldLabel("fullName")).toBe("Full name");
  });

  it("shows a kind in words, and never a linked record's id", () => {
    expect(describeRenterValue("kind", "organisation")).toBe("Business");
    expect(describeRenterValue("kind", "person")).toBe("Person");
    expect(describeRenterValue("organisationId", LINK_ID)).toBe("not shown");
    expect(describeRenterValue("driverId", LINK_ID)).toBe("not shown");
    expect(describeRenterValue("phone", WITHHELD_VALUE)).toBe("not shown");
    expect(describeRenterValue("status", "do_not_rent")).not.toBe("do_not_rent");
  });
});
