import { describe, expect, it } from "vitest";

import { formatAbn, isValidAbn, normaliseAbn } from "./abn";

describe("ABNs", () => {
  it("accepts a real ABN, with or without spaces", () => {
    // The ATO's own published example.
    expect(isValidAbn("51824753556")).toBe(true);
    expect(isValidAbn("51 824 753 556")).toBe(true);
  });

  it("refuses a one-digit typo and a swapped pair", () => {
    expect(isValidAbn("51824753557")).toBe(false);
    expect(isValidAbn("15824753556")).toBe(false);
  });

  it("refuses anything that is not 11 digits", () => {
    expect(isValidAbn("5182475355")).toBe(false);
    expect(isValidAbn("518247535560")).toBe(false);
    expect(isValidAbn("51-824-753-556")).toBe(false);
    expect(isValidAbn("")).toBe(false);
  });

  it("stores digits only, and shows them grouped the usual way", () => {
    expect(normaliseAbn("51 824 753 556")).toBe("51824753556");
    expect(formatAbn("51824753556")).toBe("51 824 753 556");
  });
});
