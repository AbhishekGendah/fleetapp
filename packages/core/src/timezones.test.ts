import { describe, expect, it } from "vitest";

import { AUSTRALIAN_TIMEZONES, isAustralianTimezone } from "./timezones";

describe("Australian timezones", () => {
  it("are all real timezones", () => {
    for (const zone of AUSTRALIAN_TIMEZONES) {
      expect(() => new Intl.DateTimeFormat("en-AU", { timeZone: zone.id })).not.toThrow();
    }
  });

  it("accept only Australian zones", () => {
    expect(isAustralianTimezone("Australia/Perth")).toBe(true);
    expect(isAustralianTimezone("Pacific/Auckland")).toBe(false);
    expect(isAustralianTimezone("not a zone")).toBe(false);
  });
});
