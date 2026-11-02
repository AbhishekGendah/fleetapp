import { describe, expect, it } from "vitest";

import {
  kilometresDriven,
  recordedReturnTime,
  renterAbsentText,
  returnAcceptanceText,
  returnTimeProblem,
} from "./vehicle-return";

const HANDED_OVER = new Date("2026-10-01T02:00:00Z");
const NOW = new Date("2026-11-02T01:30:00Z");

describe("the return time", () => {
  it("is fine between the handover and now, including an after-hours drop-off entered later", () => {
    expect(
      returnTimeProblem(new Date("2026-11-01T12:00:00Z"), { handedOverAt: HANDED_OVER, now: NOW }),
    ).toBeNull();
    expect(returnTimeProblem(NOW, { handedOverAt: HANDED_OVER, now: NOW })).toBeNull();
  });

  it("is never at or before the handover", () => {
    expect(returnTimeProblem(HANDED_OVER, { handedOverAt: HANDED_OVER, now: NOW })).toBe(
      "before_handover",
    );
  });

  it("is never in the future, allowing a few minutes for the phone's clock", () => {
    expect(
      returnTimeProblem(new Date("2026-11-02T01:33:00Z"), { handedOverAt: HANDED_OVER, now: NOW }),
    ).toBeNull();
    expect(
      returnTimeProblem(new Date("2026-11-02T02:00:00Z"), { handedOverAt: HANDED_OVER, now: NOW }),
    ).toBe("in_future");
  });
});

describe("the return time recorded", () => {
  const PERTH = "Australia/Perth";

  it("takes a time left at now, or typed in the handover's minute, as now to the second", () => {
    const now = new Date("2026-11-02T01:30:42Z");
    const handedOverAt = new Date("2026-11-02T01:30:10Z");
    expect(
      recordedReturnTime(new Date("2026-11-02T01:30:00Z"), { handedOverAt, now, timeZone: PERTH }),
    ).toEqual({ at: now });
    expect(
      recordedReturnTime(new Date("2026-11-02T01:30:00Z"), {
        handedOverAt: HANDED_OVER,
        now,
        timeZone: PERTH,
      }),
    ).toEqual({ at: now });
  });

  it("keeps an earlier time as typed, and refuses one before the handover", () => {
    const typed = new Date("2026-10-30T13:30:00Z");
    expect(
      recordedReturnTime(typed, { handedOverAt: HANDED_OVER, now: NOW, timeZone: PERTH }),
    ).toEqual({ at: typed });
    expect(
      recordedReturnTime(new Date("2026-09-30T00:00:00Z"), {
        handedOverAt: HANDED_OVER,
        now: NOW,
        timeZone: PERTH,
      }),
    ).toEqual({ problem: "before_handover" });
  });
});

describe("the return's words", () => {
  it("counts the kilometres driven once both readings are in", () => {
    expect(kilometresDriven(45_210, 47_030)).toBe(1_820);
    expect(kilometresDriven(45_210, null)).toBeNull();
  });

  it("says what the Renter accepts, on the Operator's clock", () => {
    expect(
      returnAcceptanceText({
        at: NOW,
        timeZone: "Australia/Perth",
        odometerKm: 47_030,
        fuelLevel: "half",
      }),
    ).toMatch(
      /^I returned this car on .*2 Nov.*9:30.*, with 47,030 km on the odometer and 1\/2 fuel/,
    );
    expect(renterAbsentText({ at: NOW, timeZone: "Australia/Perth" })).toMatch(
      /^The Renter was not present\./,
    );
  });
});
