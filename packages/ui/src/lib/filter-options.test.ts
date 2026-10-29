import { describe, expect, it } from "vitest";

import { filterOptions } from "./filter-options";

const MODELS = ["Camry", "Corolla", "Corolla Cross", "C-HR", "Yaris Cross"];

describe("filterOptions", () => {
  it("puts names that start with the text before names that contain it", () => {
    expect(filterOptions(MODELS, "cro")).toEqual(["Corolla Cross", "Yaris Cross"]);
    expect(filterOptions(MODELS, "co")).toEqual(["Corolla", "Corolla Cross"]);
  });

  it("ignores case and surrounding spaces", () => {
    expect(filterOptions(MODELS, "  CAM ")).toEqual(["Camry"]);
  });

  it("offers the whole list for an empty box", () => {
    expect(filterOptions(MODELS, "")).toEqual(MODELS);
  });

  it("offers nothing for text that matches nothing", () => {
    expect(filterOptions(MODELS, "Model 3")).toEqual([]);
  });
});
