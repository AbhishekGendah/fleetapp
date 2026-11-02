import { describe, expect, it } from "vitest";

import {
  DEFAULT_HANDOVER_PHOTOS,
  handoverAcceptanceText,
  handoverDetailsInputSchema,
  handoverGaps,
  handoverPhotoListSchema,
  photoListFromLines,
} from "./handover";

describe("handover", () => {
  it("reads the photo list one per line, and wants each photo once", () => {
    const names = photoListFromLines("Front\n\n  Rear  \r\nfront\n");

    expect(names).toEqual(["Front", "Rear", "front"]);
    expect(handoverPhotoListSchema.safeParse(names).success).toBe(false);
    expect(handoverPhotoListSchema.safeParse([]).success).toBe(false);
    expect(handoverPhotoListSchema.safeParse([...DEFAULT_HANDOVER_PHOTOS]).success).toBe(true);
  });

  it("takes keys as one digit from 1 to 9, and a fuel level from the list", () => {
    const parse = (keysCount: string, fuelLevel = "half") =>
      handoverDetailsInputSchema.safeParse({ fuelLevel, keysCount, accessories: "", notes: "" });

    expect(parse("2").data?.keysCount).toBe(2);
    expect(parse("0").success).toBe(false);
    expect(parse("10").success).toBe(false);
    expect(parse("2", "lots").success).toBe(false);
  });

  it("lists what is still missing before the Renter can accept, in checklist order", () => {
    const gaps = handoverGaps({
      photoNames: ["Front", "Rear"],
      photosTaken: new Set(["Rear"]),
      odometerKm: 1000,
      fuelLevel: null,
      keysCount: 2,
      damageMarks: [{ hasPhoto: true }, { hasPhoto: false }],
    });

    expect(gaps).toEqual([
      { kind: "photo", name: "Front" },
      { kind: "fuel" },
      { kind: "damage_photo" },
    ]);
  });

  it("words the acceptance with the time, kilometres and fuel on the Operator's clock", () => {
    const text = handoverAcceptanceText({
      at: new Date("2027-06-01T01:30:00Z"),
      timeZone: "Australia/Perth",
      odometerKm: 12345,
      fuelLevel: "three_quarters",
    });

    expect(text).toContain("12,345 km");
    expect(text).toContain("3/4 fuel");
    expect(text).toContain("9:30 am");
  });
});
