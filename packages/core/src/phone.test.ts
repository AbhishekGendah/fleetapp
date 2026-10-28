import { describe, expect, it } from "vitest";

import { formatAustralianPhone, isValidAustralianPhone } from "./phone";

describe("formatting Australian phone numbers", () => {
  it("formats mobiles 4-3-3", () => {
    expect(formatAustralianPhone("0412345678")).toBe("0412 345 678");
    expect(formatAustralianPhone("04123")).toBe("0412 3");
  });

  it("puts landline area codes in brackets", () => {
    expect(formatAustralianPhone("0891234567")).toBe("(08) 9123 4567");
    expect(formatAustralianPhone("089")).toBe("(08) 9");
    expect(formatAustralianPhone("08")).toBe("(08");
  });

  it("formats 1300, 1800 and 13 numbers", () => {
    expect(formatAustralianPhone("1300123456")).toBe("1300 123 456");
    expect(formatAustralianPhone("1800123456")).toBe("1800 123 456");
    expect(formatAustralianPhone("131234")).toBe("13 12 34");
  });

  it("turns +61 into the national form", () => {
    expect(formatAustralianPhone("+61 412 345 678")).toBe("0412 345 678");
    expect(formatAustralianPhone("+61891234567")).toBe("(08) 9123 4567");
  });

  it("lets +61 be typed one key at a time", () => {
    expect(formatAustralianPhone("+")).toBe("+");
    expect(formatAustralianPhone("+6")).toBe("+6");
    expect(formatAustralianPhone("+61")).toBe("+61");
    expect(formatAustralianPhone("+614")).toBe("04");
  });

  it("stops at the most digits a number can have", () => {
    expect(formatAustralianPhone("08896496849684")).toBe("(08) 8964 9684");
    expect(formatAustralianPhone("1312345678")).toBe("13 12 34");
  });

  it("reformats what is already formatted without changing it", () => {
    expect(formatAustralianPhone("(08) 9123 4567")).toBe("(08) 9123 4567");
  });
});

describe("checking Australian phone numbers", () => {
  it("accepts complete numbers of each kind", () => {
    for (const number of ["0412 345 678", "(08) 9123 4567", "1300 123 456", "13 12 34"]) {
      expect(isValidAustralianPhone(number)).toBe(true);
    }
  });

  it("refuses unfinished numbers and unknown prefixes", () => {
    expect(isValidAustralianPhone("0412 345")).toBe(false);
    expect(isValidAustralianPhone("09 1234 5678")).toBe(false);
    expect(isValidAustralianPhone("call me")).toBe(false);
  });
});
