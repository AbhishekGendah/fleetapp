import { describe, expect, it } from "vitest";

import { carMoneyTotals } from "./vehicle-costs";

describe("a car's money totals", () => {
  it("adds refurb and other costs separately, with their GST", () => {
    const totals = carMoneyTotals({
      purchase: null,
      costs: [
        { kind: "refurb", amountCents: 110_00, gstCents: 10_00 },
        { kind: "refurb", amountCents: 55_00, gstCents: 5_00 },
        { kind: "repair", amountCents: 220_00, gstCents: 20_00 },
        { kind: "other", amountCents: 30_00, gstCents: 0 },
      ],
      sale: null,
    });
    expect(totals.refurb).toEqual({ amountCents: 165_00, gstCents: 15_00 });
    expect(totals.otherCosts).toEqual({ amountCents: 250_00, gstCents: 20_00 });
    expect(totals.differenceExcludingGstCents).toBeNull();
  });

  it("works out the difference without GST once bought and sold", () => {
    const totals = carMoneyTotals({
      // Bought privately (no GST), sold by a GST-registered Operator.
      purchase: { amountCents: 20_000_00, gstCents: 0 },
      costs: [{ kind: "refurb", amountCents: 1_100_00, gstCents: 100_00 }],
      sale: { amountCents: 27_500_00, gstCents: 2_500_00 },
    });
    // 25,000 - 20,000 - 1,000
    expect(totals.differenceExcludingGstCents).toBe(4_000_00);
  });

  it("has nothing to add for a car with no records", () => {
    const totals = carMoneyTotals({ purchase: null, costs: [], sale: null });
    expect(totals.refurb).toEqual({ amountCents: 0, gstCents: 0 });
    expect(totals.bought).toBeNull();
  });
});
