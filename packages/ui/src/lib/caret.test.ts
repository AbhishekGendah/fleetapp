import { describe, expect, it } from "vitest";

import { countDigitsBefore, positionAfterDigits, removeDigit } from "./caret";

describe("keeping the cursor in place while a box reformats", () => {
  it("counts the digits before a position", () => {
    expect(countDigitsBefore("(08) 9123", 5)).toBe(2);
    expect(countDigitsBefore("0412 345", 8)).toBe(7);
  });

  it("finds the position after a number of digits", () => {
    expect(positionAfterDigits("(08) 9123", 3)).toBe(6);
    expect(positionAfterDigits("0412 345", 4)).toBe(4);
    expect(positionAfterDigits("0412 345", 99)).toBe(8);
  });

  it("puts the cursor inside a leading bracket when no digits come before it", () => {
    expect(positionAfterDigits("(08) 9123", 0)).toBe(1);
    expect(positionAfterDigits("", 0)).toBe(0);
  });

  it("removes one digit, leaving the rest", () => {
    expect(removeDigit("0412 345", 4)).toBe("041 345");
    expect(removeDigit("0412 345", 0)).toBe("0412 345");
  });
});
