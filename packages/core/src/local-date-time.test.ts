import { describe, expect, it } from "vitest";

import { isLocalDateTime, localDateTimeToUtc, utcToLocalDateTime } from "./local-date-time";

describe("local clock time to UTC", () => {
  it("uses Perth's fixed offset", () => {
    expect(localDateTimeToUtc("2026-10-30T14:15", "Australia/Perth")?.toISOString()).toBe(
      "2026-10-30T06:15:00.000Z",
    );
  });

  it("uses Sydney's daylight time in summer and standard time in winter", () => {
    expect(localDateTimeToUtc("2027-01-10T09:00", "Australia/Sydney")?.toISOString()).toBe(
      "2027-01-09T22:00:00.000Z",
    );
    expect(localDateTimeToUtc("2026-07-10T09:00", "Australia/Sydney")?.toISOString()).toBe(
      "2026-07-09T23:00:00.000Z",
    );
  });

  it("handles Adelaide's half-hour offset", () => {
    expect(localDateTimeToUtc("2026-07-10T09:00", "Australia/Adelaide")?.toISOString()).toBe(
      "2026-07-09T23:30:00.000Z",
    );
  });

  it("refuses a time skipped when daylight saving starts", () => {
    // Sydney clocks jumped from 2:00 to 3:00 on 4 Oct 2026.
    expect(localDateTimeToUtc("2026-10-04T02:30", "Australia/Sydney")).toBeNull();
    expect(localDateTimeToUtc("2026-10-04T03:00", "Australia/Sydney")?.toISOString()).toBe(
      "2026-10-03T16:00:00.000Z",
    );
  });

  it("takes the first of a time repeated when daylight saving ends", () => {
    // Sydney clocks go back from 3:00 to 2:00 on 4 Apr 2027: 2:30 happens twice.
    expect(localDateTimeToUtc("2027-04-04T02:30", "Australia/Sydney")?.toISOString()).toBe(
      "2027-04-03T15:30:00.000Z",
    );
  });

  it("refuses what is not a date and time", () => {
    expect(localDateTimeToUtc("2026-02-30T10:00", "Australia/Perth")).toBeNull();
    expect(localDateTimeToUtc("2026-10-30 10:00", "Australia/Perth")).toBeNull();
    expect(isLocalDateTime("2026-10-30T24:00")).toBe(false);
    expect(isLocalDateTime("2026-10-30T23:59")).toBe(true);
  });
});

describe("UTC to a local clock time", () => {
  it("is what a date-and-time box shows, and converts back", () => {
    const moment = new Date("2027-01-09T22:00:00Z");
    expect(utcToLocalDateTime(moment, "Australia/Sydney")).toBe("2027-01-10T09:00");
    expect(utcToLocalDateTime(moment, "Australia/Perth")).toBe("2027-01-10T06:00");
    expect(
      localDateTimeToUtc(utcToLocalDateTime(moment, "Australia/Darwin"), "Australia/Darwin"),
    ).toEqual(moment);
  });
});
