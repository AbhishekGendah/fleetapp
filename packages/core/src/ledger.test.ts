import { describe, expect, it } from "vitest";

import { weekdayOfDate } from "./calendar-dates";
import {
  dailyShares,
  gstForLine,
  isGstRegisteredOn,
  ledgerBalanceCents,
  owingCharges,
  reversibleLineIds,
  statementFigures,
  type DatedLedgerLine,
} from "./ledger";

const TUESDAY = 2;

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

describe("a statement", () => {
  const lines = [
    line("rent-1", "charge", 350_00, "2026-11-03"),
    line("paid-1", "payment", 350_00, "2026-11-04"),
    line("rent-2", "charge", 350_00, "2026-11-10"),
    line("clean", "charge", 80_00, "2026-11-12"),
    line("undo-clean", "reversal", 80_00, "2026-11-13", "clean"),
    line("rent-3", "charge", 350_00, "2026-11-17"),
  ];

  it("opens with the balance before its first day and runs each line's balance", () => {
    const figures = statementFigures(lines, "2026-11-10", "2026-11-13");

    expect(figures.openingCents).toBe(0);
    expect(figures.lines.map((row) => [row.line.id, row.balanceAfterCents])).toEqual([
      ["rent-2", 350_00],
      ["clean", 430_00],
      ["undo-clean", 350_00],
    ]);
    expect(figures.closingCents).toBe(350_00);
  });

  it("takes in the whole ledger, and a reversal of a line before the range still counts", () => {
    expect(statementFigures(lines, "2026-11-01", "2026-11-30").closingCents).toBe(
      ledgerBalanceCents(lines),
    );
    const late = statementFigures(lines, "2026-11-13", "2026-11-13");
    expect(late.openingCents).toBe(430_00);
    expect(late.closingCents).toBe(350_00);
  });

  it("is empty for days with no lines", () => {
    expect(statementFigures(lines, "2026-12-01", "2026-12-31")).toEqual({
      openingCents: ledgerBalanceCents(lines),
      lines: [],
      closingCents: ledgerBalanceCents(lines),
    });
  });
});
