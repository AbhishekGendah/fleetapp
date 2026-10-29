import { describe, expect, it } from "vitest";

import { listedName, modelsForMake, VEHICLE_MAKES, VEHICLE_MODELS } from "./vehicle-models";
import {
  findOdometerDrops,
  isValidVin,
  latestVehicleYear,
  needsReturnDate,
  normaliseRego,
  normaliseVin,
} from "./vehicles";

describe("normaliseRego", () => {
  it("ignores case, spaces, dots and dashes", () => {
    expect(normaliseRego(" 1abc 234 ")).toBe("1ABC234");
    expect(normaliseRego("ab-12.cd")).toBe("AB12CD");
  });
});

describe("VIN", () => {
  it("accepts 17 letters and digits, in any case, with spaces", () => {
    expect(isValidVin("jtdkb20u993507711")).toBe(true);
    expect(isValidVin("JTDKB 20U99 3507711")).toBe(true);
    expect(normaliseVin("jtdkb 20u993507711")).toBe("JTDKB20U993507711");
  });

  it("refuses the wrong length and the letters I, O and Q", () => {
    expect(isValidVin("JTDKB20U99350771")).toBe(false);
    expect(isValidVin("JTDKB20U99350771I")).toBe(false);
    expect(isValidVin("OTDKB20U993507711")).toBe(false);
    expect(isValidVin("QTDKB20U993507711")).toBe(false);
  });
});

describe("latestVehicleYear", () => {
  it("allows next year's models", () => {
    expect(latestVehicleYear(new Date("2026-10-29T00:00:00Z"))).toBe(2027);
  });
});

describe("needsReturnDate", () => {
  it("is only for cars off the road for a while", () => {
    expect(needsReturnDate("in_service")).toBe(true);
    expect(needsReturnDate("off_road")).toBe(true);
    expect(needsReturnDate("available")).toBe(false);
    expect(needsReturnDate("sold")).toBe(false);
  });
});

describe("findOdometerDrops", () => {
  it("flags each reading lower than the one before it", () => {
    const drops = findOdometerDrops([
      { id: "a", kilometres: 10_000 },
      { id: "b", kilometres: 12_000 },
      { id: "c", kilometres: 1_200 },
      { id: "d", kilometres: 12_500 },
      { id: "e", kilometres: 12_500 },
    ]);
    expect([...drops]).toEqual(["c"]);
  });

  it("flags nothing in an empty or single history", () => {
    expect(findOdometerDrops([]).size).toBe(0);
    expect(findOdometerDrops([{ id: "a", kilometres: 5 }]).size).toBe(0);
  });
});

describe("make and model list", () => {
  it("has the usual rental cars", () => {
    expect(modelsForMake("Toyota")).toContain("Camry");
    expect(modelsForMake("Tesla")).toContain("Model 3");
  });

  it("finds the listed spelling whatever the case", () => {
    expect(listedName(VEHICLE_MAKES, " toyota ")).toBe("Toyota");
    expect(modelsForMake("mercedes-benz")).toContain("C-Class");
  });

  it("returns nothing for a make it does not know", () => {
    expect(listedName(VEHICLE_MAKES, "Trabant")).toBeNull();
    expect(modelsForMake("Trabant")).toEqual([]);
  });

  it("lists no make or model twice", () => {
    const lowerMakes = VEHICLE_MAKES.map((make) => make.toLowerCase());
    expect(new Set(lowerMakes).size).toBe(lowerMakes.length);
    for (const models of Object.values(VEHICLE_MODELS)) {
      const lowerModels = models.map((model) => model.toLowerCase());
      expect(new Set(lowerModels).size).toBe(lowerModels.length);
    }
  });
});
