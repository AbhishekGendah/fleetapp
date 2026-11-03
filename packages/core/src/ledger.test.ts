import { describe, expect, it } from "vitest";

import { weekdayOfDate } from "./calendar-dates";
import {
  dailyShares,
  dueRentPeriods,
  gstForLine,
  isGstRegisteredOn,
  ledgerBalanceCents,
  owingCharges,
  rentForDays,
  rentForPeriod,
  reversibleLineIds,
  unusedDaysCredit,
  type DatedLedgerLine,
  type RateFromDate,
} from "./ledger";

const TUESDAY = 2;
const RATE_350: RateFromDate[] = [{ appliesFrom: "2026-01-01", weeklyRateCents: 350_00 }];

function line(
  id: string,
  kind: DatedLedgerLine["kind"],
  amountCents: number,
  effectiveOn: string,
  reversesId: string | null = null,
): DatedLedgerLine {
  return { id, kind, amountCents, effectiveOn, reversesId };
}

describe("dates", () => {
  it("knows each date's weekday, Monday 1 to Sunday 7", () => {
    expect(weekdayOfDate("2026-11-02")).toBe(1);
    expect(weekdayOfDate("2026-11-03")).toBe(TUESDAY);
    expect(weekdayOfDate("2026-11-08")).toBe(7);
    expect(weekdayOfDate("2023-12-31")).toBe(7);
  });
});

describe("GST on a line", () => {
  it("is one-eleventh of a taxable amount, to the nearest cent, only while registered", () => {
    expect(gstForLine(350_00, "taxable", true)).toBe(31_82);
    expect(gstForLine(110_00, "taxable", true)).toBe(10_00);
    expect(gstForLine(5, "taxable", true)).toBe(0);
    expect(gstForLine(6, "taxable", true)).toBe(1);
    expect(gstForLine(350_00, "taxable", false)).toBe(0);
    expect(gstForLine(350_00, "gst_free", true)).toBe(0);
    expect(gstForLine(350_00, "no_gst", true)).toBe(0);
  });

  it("counts registration from its date", () => {
    expect(isGstRegisteredOn("2026-07-01", "2026-06-30")).toBe(false);
    expect(isGstRegisteredOn("2026-07-01", "2026-07-01")).toBe(true);
    expect(isGstRegisteredOn(null, "2026-07-01")).toBe(false);
  });
});

describe("a weekly rate by the day", () => {
  it("splits into seven days that add back exactly", () => {
    expect(dailyShares(350_00)).toEqual(Array(7).fill(50_00));
    expect(dailyShares(350_05)).toEqual([50_01, 50_01, 50_01, 50_01, 50_01, 50_00, 50_00]);
    for (const rate of [1, 6, 7, 99_99, 333_33, 480_00, 1_000_003]) {
      expect(dailyShares(rate).reduce((sum, share) => sum + share, 0)).toBe(rate);
    }
  });

  it("charges each day at the rate in force on it", () => {
    const rising: RateFromDate[] = [
      ...RATE_350,
      { appliesFrom: "2026-11-06", weeklyRateCents: 420_00 },
    ];
    // Tue 3 to Mon 9 Nov: three days at $50, four at $60.
    expect(rentForDays(rising, "2026-11-03", 7)).toBe(3 * 50_00 + 4 * 60_00);
    expect(rentForDays(RATE_350, "2026-11-03", 7)).toBe(350_00);
    expect(rentForDays(RATE_350, "2026-11-03", 3)).toBe(150_00);
    // Handed over a day before the first rate: that day is at the first rate.
    expect(rentForDays(RATE_350, "2025-12-31", 1)).toBe(50_00);
    expect(() => rentForDays([], "2026-11-03", 1)).toThrow(RangeError);
  });
});

describe("rent periods", () => {
  it("starts at the handover with a part week up to the first charge day", () => {
    // Handover Thursday 5 Nov; rent charged on Tuesdays.
    expect(
      dueRentPeriods({
        handoverDate: "2026-11-05",
        chargeWeekday: TUESDAY,
        today: "2026-11-17",
        returnDate: null,
      }),
    ).toEqual([
      { start: "2026-11-05", end: "2026-11-10", isPartWeek: true },
      { start: "2026-11-10", end: "2026-11-17", isPartWeek: false },
      { start: "2026-11-17", end: "2026-11-24", isPartWeek: false },
    ]);
  });

  it("has no part week when the handover is on the charge day, and nothing due before it", () => {
    const fromTuesday = { handoverDate: "2026-11-03", chargeWeekday: TUESDAY as 2 };
    expect(dueRentPeriods({ ...fromTuesday, today: "2026-11-09", returnDate: null })).toEqual([
      { start: "2026-11-03", end: "2026-11-10", isPartWeek: false },
    ]);
    expect(dueRentPeriods({ ...fromTuesday, today: "2026-11-02", returnDate: null })).toEqual([]);
  });

  it("starts no period on or after the return, and keeps going while overdue", () => {
    const base = { handoverDate: "2026-11-03", chargeWeekday: TUESDAY as 2, today: "2027-01-05" };
    expect(dueRentPeriods({ ...base, returnDate: "2026-11-10" })).toHaveLength(1);
    expect(dueRentPeriods({ ...base, returnDate: "2026-11-11" })).toHaveLength(2);
    expect(dueRentPeriods({ ...base, returnDate: null })).toHaveLength(10);
  });

  it("charges a part week by the day, or as a full week, as the rental says", () => {
    const part = { start: "2026-11-05", end: "2026-11-10", isPartWeek: true };
    expect(rentForPeriod(RATE_350, part, "daily_pro_rata")).toBe(250_00);
    expect(rentForPeriod(RATE_350, part, "full_week")).toBe(350_00);
    const week = { start: "2026-11-10", end: "2026-11-17", isPartWeek: false };
    expect(rentForPeriod(RATE_350, week, "daily_pro_rata")).toBe(350_00);
  });

  it("credits the days after an early return, the return day counting as used", () => {
    const week = { start: "2026-11-10", end: "2026-11-17", isPartWeek: false };
    // Back Thursday 12 Nov: three days used, four credited.
    expect(unusedDaysCredit(RATE_350, week, "2026-11-12", "daily_pro_rata")).toBe(200_00);
    expect(unusedDaysCredit(RATE_350, week, "2026-11-16", "daily_pro_rata")).toBe(0);
    expect(unusedDaysCredit(RATE_350, week, "2026-11-12", "full_week")).toBe(0);
    expect(unusedDaysCredit(RATE_350, week, "2026-11-20", "daily_pro_rata")).toBe(0);
    // The odd cents: what is charged minus what is credited is what the used days cost.
    const odd: RateFromDate[] = [{ appliesFrom: "2026-01-01", weeklyRateCents: 333_33 }];
    const charged = rentForPeriod(odd, week, "daily_pro_rata");
    const credited = unusedDaysCredit(odd, week, "2026-11-12", "daily_pro_rata");
    expect(charged - credited).toBe(rentForDays(odd, week.start, 3));
  });
});

describe("the balance", () => {
  it("adds charges and refunds, takes off payments and credits, and undoes reversals", () => {
    const lines = [
      line("rent", "charge", 350_00, "2026-11-03"),
      line("paid", "payment", 300_00, "2026-11-04"),
      line("clean", "charge", 80_00, "2026-11-05"),
      line("fix", "reversal", 80_00, "2026-11-06", "clean"),
      line("credit", "credit", 20_00, "2026-11-07"),
      line("back", "refund", 5_00, "2026-11-08"),
    ];
    expect(ledgerBalanceCents(lines)).toBe(350_00 - 300_00 - 20_00 + 5_00);
    expect(
      ledgerBalanceCents([...lines, line("unpay", "reversal", 300_00, "2026-11-09", "paid")]),
    ).toBe(350_00 - 20_00 + 5_00);
    expect(reversibleLineIds(lines)).toEqual(new Set(["rent", "paid", "credit", "back"]));
  });

  it("pays off the oldest charges first, so what is owing has an age", () => {
    const lines = [
      line("week1", "charge", 350_00, "2026-11-03"),
      line("week2", "charge", 350_00, "2026-11-10"),
      line("paid", "payment", 400_00, "2026-11-11"),
      line("week3", "charge", 350_00, "2026-11-17"),
    ];
    expect(owingCharges(lines)).toEqual([
      { id: "week2", effectiveOn: "2026-11-10", owingCents: 300_00 },
      { id: "week3", effectiveOn: "2026-11-17", owingCents: 350_00 },
    ]);
    const settled = [...lines, line("paid2", "payment", 650_00, "2026-11-18")];
    expect(owingCharges(settled)).toEqual([]);
    const bounced = [...settled, line("bounce", "reversal", 650_00, "2026-11-20", "paid2")];
    expect(owingCharges(bounced).reduce((sum, owing) => sum + owing.owingCents, 0)).toBe(
      ledgerBalanceCents(bounced),
    );
  });
});
