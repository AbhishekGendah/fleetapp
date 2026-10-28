import { describe, expect, it } from "vitest";

import { formatPostcode, isAustralianStateCode, postcodeMatchesState } from "./postcodes";

describe("postcodes and states", () => {
  it("matches each state's usual postcodes", () => {
    expect(postcodeMatchesState("6000", "WA")).toBe(true);
    expect(postcodeMatchesState("2000", "NSW")).toBe(true);
    expect(postcodeMatchesState("3000", "VIC")).toBe(true);
    expect(postcodeMatchesState("4000", "QLD")).toBe(true);
    expect(postcodeMatchesState("5000", "SA")).toBe(true);
    expect(postcodeMatchesState("7000", "TAS")).toBe(true);
    expect(postcodeMatchesState("0800", "NT")).toBe(true);
  });

  it("knows the ACT's postcodes inside the NSW range", () => {
    expect(postcodeMatchesState("2600", "ACT")).toBe(true);
    expect(postcodeMatchesState("2600", "NSW")).toBe(false);
    expect(postcodeMatchesState("0200", "ACT")).toBe(true);
  });

  it("notices a postcode from another state", () => {
    expect(postcodeMatchesState("6000", "NSW")).toBe(false);
  });

  it("notices a postcode that is not 4 digits", () => {
    expect(postcodeMatchesState("600", "WA")).toBe(false);
    expect(postcodeMatchesState("60000", "WA")).toBe(false);
  });

  it("keeps only the first 4 digits as a postcode is typed", () => {
    expect(formatPostcode("60a0")).toBe("600");
    expect(formatPostcode("600012")).toBe("6000");
  });

  it("knows the state and territory codes", () => {
    expect(isAustralianStateCode("WA")).toBe(true);
    expect(isAustralianStateCode("wa")).toBe(false);
    expect(isAustralianStateCode("")).toBe(false);
  });
});
