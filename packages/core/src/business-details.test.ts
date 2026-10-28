import { describe, expect, it } from "vitest";

import { hasRequiredBusinessDetails, isRequiredBusinessDetail } from "./business-details";

const COMPLETE = {
  legalName: "Test Rentals Pty Ltd",
  abn: "51824753556",
  addressLine1: "1 Example Street",
  suburb: "Perth",
  state: "WA",
  postcode: "6000",
  phone: "0400 000 000",
  email: "hello@example.test",
};

describe("the required business details", () => {
  it("are all there only when none is blank or just spaces", () => {
    expect(hasRequiredBusinessDetails(COMPLETE)).toBe(true);
    expect(hasRequiredBusinessDetails({ ...COMPLETE, phone: null })).toBe(false);
    expect(hasRequiredBusinessDetails({ ...COMPLETE, suburb: "   " })).toBe(false);
  });

  it("leave out the trading name and second address line", () => {
    expect(isRequiredBusinessDetail("abn")).toBe(true);
    expect(isRequiredBusinessDetail("tradingName")).toBe(false);
    expect(isRequiredBusinessDetail("addressLine2")).toBe(false);
  });
});
