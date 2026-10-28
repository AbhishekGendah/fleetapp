import { describe, expect, it } from "vitest";

import { checkGstRegistration } from "./gst";

describe("GST registration", () => {
  it("is fine registered with a date, or unregistered without one", () => {
    expect(checkGstRegistration({ isRegistered: true, registeredFrom: "2024-07-01" })).toBeNull();
    expect(checkGstRegistration({ isRegistered: false, registeredFrom: null })).toBeNull();
  });

  it("needs the date when registered", () => {
    expect(checkGstRegistration({ isRegistered: true, registeredFrom: null })).toBe("missing_date");
  });

  it("refuses a date when not registered", () => {
    expect(checkGstRegistration({ isRegistered: false, registeredFrom: "2024-07-01" })).toBe(
      "date_without_registration",
    );
  });

  it("refuses a date before GST existed", () => {
    expect(checkGstRegistration({ isRegistered: true, registeredFrom: "1999-01-01" })).toBe(
      "before_gst",
    );
  });
});
