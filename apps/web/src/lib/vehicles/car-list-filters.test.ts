import { describe, expect, it } from "vitest";

import { carListFilterCounts, carListFilterOf } from "./car-list-filters";

describe("the Cars list's filters", () => {
  it("takes its own plain words", () => {
    expect(carListFilterOf("out")).toBe("out");
    expect(carListFilterOf("workshop")).toBe("workshop");
    expect(carListFilterOf("archived")).toBe("archived");
    expect(carListFilterOf(undefined)).toBeUndefined();
    expect(carListFilterOf("nonsense")).toBeUndefined();
  });

  it("opens the filter that holds an old address's status", () => {
    expect(carListFilterOf("rented")).toBe("out");
    expect(carListFilterOf("in_service")).toBe("workshop");
    expect(carListFilterOf("off_road")).toBe("workshop");
    expect(carListFilterOf("written_off")).toBe("written-off");
  });

  it("counts each filter, the workshop as in service and off road together", () => {
    expect(carListFilterCounts({ rented: 7, available: 3, in_service: 1, off_road: 1 }, 2)).toEqual(
      {
        all: 12,
        out: 7,
        available: 3,
        workshop: 2,
        sold: 0,
        "written-off": 0,
        archived: 2,
      },
    );
  });
});
