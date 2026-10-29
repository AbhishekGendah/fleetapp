import { describe, expect, it } from "vitest";

import { operatorDisplayName } from "./operator-name";
import { digitsOnly } from "./text";

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
