import { describe, expect, it } from "vitest";

import { isCarStillOutFor } from "./availability";

/** Due back 10am Perth on Tue 3 Nov 2026; the asking happens five days later. */
const DUE_BACK = new Date("2026-11-03T02:00:00Z");
const NOW = new Date("2026-11-08T02:00:00Z");
const HOUR_MS = 60 * 60 * 1000;

function at(iso: string): Date {
  return new Date(iso);
}

describe("isCarStillOutFor", () => {
  it("refuses a booking from the old return time, which used to look free", () => {
    expect(
      isCarStillOutFor({ start: DUE_BACK, end: at("2026-11-10T02:00:00Z") }, DUE_BACK, NOW),
    ).toBe(true);
  });

  it("refuses dates far ahead, since nobody knows when the car comes back", () => {
    expect(
      isCarStillOutFor(
        { start: at("2027-01-04T01:00:00Z"), end: at("2027-02-01T01:00:00Z") },
        DUE_BACK,
        NOW,
      ),
    ).toBe(true);
  });

  it("refuses an ongoing booking", () => {
    expect(isCarStillOutFor({ start: at("2026-12-01T01:00:00Z"), end: null }, DUE_BACK, NOW)).toBe(
      true,
    );
  });

  it("refuses a span starting before the planned end that runs past it", () => {
    expect(
      isCarStillOutFor(
        { start: at("2026-11-01T02:00:00Z"), end: at("2026-11-03T03:00:00Z") },
        DUE_BACK,
        NOW,
      ),
    ).toBe(true);
  });

  it("leaves a span ending by the planned end to the ordinary clash check", () => {
    expect(
      isCarStillOutFor({ start: at("2026-10-20T02:00:00Z"), end: DUE_BACK }, DUE_BACK, NOW),
    ).toBe(false);
  });

  it("changes nothing while the car is not yet past its planned end", () => {
    const beforeDue = new Date(DUE_BACK.getTime() - HOUR_MS);
    expect(isCarStillOutFor({ start: DUE_BACK, end: null }, DUE_BACK, beforeDue)).toBe(false);
  });

  it("counts the car late only once its planned end has passed, not at that very moment", () => {
    expect(isCarStillOutFor({ start: DUE_BACK, end: null }, DUE_BACK, DUE_BACK)).toBe(false);
    expect(
      isCarStillOutFor({ start: DUE_BACK, end: null }, DUE_BACK, new Date(DUE_BACK.getTime() + 1)),
    ).toBe(true);
  });

  it("adds nothing for an ongoing rental, whose hold has no end already", () => {
    expect(isCarStillOutFor({ start: NOW, end: null }, null, NOW)).toBe(false);
  });
});
