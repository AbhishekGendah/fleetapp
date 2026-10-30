import { describe, expect, it } from "vitest";

import { operatorDisplayName } from "./operator-name";
import { digitsOnly, formatWholeNumberAsTyped } from "./text";

describe("small text helpers", () => {
  it("keeps only the digits", () => {
    expect(digitsOnly("(08) 9123-4567")).toBe("0891234567");
    expect(digitsOnly("none")).toBe("");
  });

  it("calls an Operator by its trading name if it has one", () => {
    expect(operatorDisplayName({ legalName: "A Pty Ltd", tradingName: "A Cars" })).toBe("A Cars");
    expect(operatorDisplayName({ legalName: "A Pty Ltd", tradingName: null })).toBe("A Pty Ltd");
  });
});

describe("a whole-number box as it is typed", () => {
  it("adds a comma every three digits and drops anything else", () => {
    expect(formatWholeNumberAsTyped("48210", 7)).toBe("48,210");
    expect(formatWholeNumberAsTyped("1 234 567 km", 7)).toBe("1,234,567");
    expect(formatWholeNumberAsTyped("0045", 7)).toBe("45");
    expect(formatWholeNumberAsTyped("123456789", 7)).toBe("1,234,567");
  });
});
