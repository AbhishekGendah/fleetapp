import { describe, expect, it } from "vitest";

import { formatDateTimeInTimeZone } from "./format-date-time";

describe("formatting a moment in the Operator's timezone", () => {
  const moment = new Date("2026-10-27T06:15:00Z");

  it("shows the Operator's own clock", () => {
    expect(formatDateTimeInTimeZone(moment, "Australia/Perth")).toContain("2:15");
    expect(formatDateTimeInTimeZone(moment, "Australia/Sydney")).toContain("5:15");
  });

  it("crosses midnight into the right date", () => {
    const lateUtc = new Date("2026-10-27T15:30:00Z");

    expect(formatDateTimeInTimeZone(lateUtc, "Australia/Sydney")).toContain("28 Oct 2026");
    expect(formatDateTimeInTimeZone(lateUtc, "Australia/Perth")).toContain("27 Oct 2026");
  });
});
