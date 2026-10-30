import { describe, expect, it } from "vitest";

import { normaliseLicenceNumber } from "./driver-licence";

describe("driver licence numbers", () => {
  it("are capitals and digits only, at most 10 characters", () => {
    expect(normaliseLicenceNumber("12 345-67")).toBe("1234567");
    expect(normaliseLicenceNumber("s123ab")).toBe("S123AB");
    expect(normaliseLicenceNumber("12345678901234")).toBe("1234567890");
  });
});
