import { describe, expect, it } from "vitest";

import {
  centsForEditing,
  formatCents,
  gstIncludedIn,
  isPossibleGst,
  optionalDollars,
  parseDollars,
  requiredDollars,
} from "./money";

describe("parseDollars", () => {
  it("reads the ways people type amounts", () => {
    expect(parseDollars("1234.56")).toBe(123456);
    expect(parseDollars("$1,234.56")).toBe(123456);
    expect(parseDollars(" 12 ")).toBe(1200);
    expect(parseDollars("0.5")).toBe(50);
    expect(parseDollars("$ 7.05")).toBe(705);
    expect(parseDollars("1,000,000")).toBe(100000000);
  });

  it("never loses a cent to floating point", () => {
    expect(parseDollars("0.29")).toBe(29);
    expect(parseDollars("1.15")).toBe(115);
    expect(parseDollars("4.35")).toBe(435);
  });

  it("refuses what is not an amount", () => {
    for (const typed of ["", "-5", "1.234", "abc", "1,23", "12,34.00", "$", "1.2.3"]) {
      expect(parseDollars(typed)).toBeNull();
    }
  });
});

describe("showing amounts", () => {
  it("formats cents as Australian dollars", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("puts an amount back into a box as plain dollars", () => {
    expect(centsForEditing(123456)).toBe("1234.56");
    expect(centsForEditing(5)).toBe("0.05");
  });
});

describe("GST", () => {
  it("is one eleventh of a price that includes it, to the nearest cent", () => {
    expect(gstIncludedIn(110_00)).toBe(10_00);
    expect(gstIncludedIn(100_00)).toBe(909);
    expect(gstIncludedIn(5)).toBe(0);
    expect(gstIncludedIn(6)).toBe(1);
  });

  it("may be less than the full tenth but never more, and never negative", () => {
    expect(isPossibleGst(110_00, 10_00)).toBe(true);
    expect(isPossibleGst(110_00, 0)).toBe(true);
    expect(isPossibleGst(110_00, 10_01)).toBe(false);
    expect(isPossibleGst(110_00, -1)).toBe(false);
    expect(isPossibleGst(6, 1)).toBe(true);
  });
});

describe("dollar boxes", () => {
  it("turn typed dollars into cents, or explain", () => {
    expect(requiredDollars.parse("$12.50")).toBe(1250);
    expect(requiredDollars.safeParse("").success).toBe(false);
    expect(requiredDollars.safeParse("twelve").success).toBe(false);
    expect(requiredDollars.safeParse("10000000001").success).toBe(false);
  });

  it("let an optional amount be left blank", () => {
    expect(optionalDollars.parse("  ")).toBeNull();
    expect(optionalDollars.parse("3")).toBe(300);
  });
});
