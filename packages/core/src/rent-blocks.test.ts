import { describe, expect, it } from "vitest";

import {
  blockAt,
  blockRateChangeProblem,
  blocksBetween,
  blockStartsAt,
  duePeriods,
  firstRentOf,
  isBlockRateChangeSignable,
  isLongTermBooking,
  isRepricedAtDailyRate,
  nextRentOf,
  owedForPeriod,
  rentForBlocks,
  rentLinesToAdd,
  upcomingWeekStarts,
  type BlockRentTerms,
  type ChargedRentLine,
  type RentLineToAdd,
} from "./rent-blocks";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
/** Fri 27 Nov 2026, 10:00 in Sydney (daylight saving, UTC+11). */
const HANDOVER = new Date("2026-11-26T23:00:00Z");

function at(hoursAfterHandover: number): Date {
  return new Date(HANDOVER.getTime() + hoursAfterHandover * HOUR);
}

const LONG_TERM: BlockRentTerms = {
  isLongTerm: true,
  graceMinutes: 60,
  longTermMinimumDays: 7,
  bookedBlocks: 28,
  rates: [{ fromBlock: 0, dailyRateCents: 70_00, weeklyRateCents: 350_00 }],
  isDailyRateWaived: false,
};

const SHORT_HIRE: BlockRentTerms = {
  ...LONG_TERM,
  isLongTerm: false,
  bookedBlocks: 3,
};

/** Applies the lines the run would add, as the ledger would hold them. */
function asCharged(lines: readonly RentLineToAdd[]): ChargedRentLine[] {
  return lines.map((line) => ({
    kind: line.kind,
    periodFirstBlock: line.period.firstBlock,
    amountCents: line.amountCents,
    gstCents: line.correctionGstCents ?? Math.round(line.amountCents / 11),
    isCorrection: line.isCorrection,
    isReversed: false,
  }));
}

/** Runs the reconciliation until it adds nothing, returning everything it added. */
function runUntilSettled(
  terms: BlockRentTerms,
  steps: { currentBlock: number; blocksUsed: number | null }[],
): ChargedRentLine[] {
  let charged: ChargedRentLine[] = [];
  for (const progress of steps) {
    charged = [...charged, ...asCharged(rentLinesToAdd(terms, progress, charged))];
    expect(rentLinesToAdd(terms, progress, charged)).toEqual([]);
  }
  return charged;
}

function netCents(lines: readonly ChargedRentLine[]): number {
  return lines.reduce(
    (total, line) => total + (line.kind === "charge" ? line.amountCents : -line.amountCents),
    0,
  );
}

describe("24-hour blocks", () => {
  it("counts the Zippy example as 7 blocks, and grace minutes as free", () => {
    expect(blocksBetween(HANDOVER, at(168), 60)).toBe(7);
    expect(blocksBetween(HANDOVER, at(168 + 59 / 60), 60)).toBe(7);
    expect(blocksBetween(HANDOVER, at(168 + 1 + 1 / 60), 60)).toBe(8);
    expect(blocksBetween(HANDOVER, at(169.5), 60)).toBe(8);
  });

  it("charges at least one block, even for a car back within the hour", () => {
    expect(blocksBetween(HANDOVER, at(0.5), 60)).toBe(1);
    expect(blocksBetween(HANDOVER, HANDOVER, 0)).toBe(1);
  });

  it("finds the block a moment is in, and when blocks start", () => {
    expect(blockAt(HANDOVER, at(23.99))).toBe(0);
    expect(blockAt(HANDOVER, at(24))).toBe(1);
    expect(blockStartsAt(HANDOVER, 7)).toEqual(at(168));
  });

  it("is exact hours, whatever daylight saving does to the clock", () => {
    // Sydney's clocks go back at 3am on Sun 4 Apr 2027: 7 blocks are still 168 hours.
    const autumnHandover = new Date("2027-03-31T23:00:00Z");
    const back = new Date(autumnHandover.getTime() + 168 * HOUR);
    expect(blocksBetween(autumnHandover, back, 60)).toBe(7);
    expect(blockAt(autumnHandover, back)).toBe(7);
  });

  it("calls ongoing rentals and those booked for the minimum or more long-term", () => {
    expect(isLongTermBooking(null, 7)).toBe(true);
    expect(isLongTermBooking(7, 7)).toBe(true);
    expect(isLongTermBooking(6, 7)).toBe(false);
  });
});

describe("rent for blocks", () => {
  it("makes a long-term week exactly the weekly price, spreading odd cents", () => {
    const terms: BlockRentTerms = {
      ...LONG_TERM,
      rates: [{ fromBlock: 0, dailyRateCents: 70_00, weeklyRateCents: 375_00 }],
    };
    expect(rentForBlocks(terms, { firstBlock: 0, endBlock: 7 })).toBe(375_00);
    expect(rentForBlocks(terms, { firstBlock: 7, endBlock: 14 })).toBe(375_00);
  });

  it("charges a short hire at the daily rate", () => {
    expect(rentForBlocks(SHORT_HIRE, { firstBlock: 0, endBlock: 3 })).toBe(210_00);
  });

  it("uses seven daily rates when a long-term rental has no weekly price", () => {
    const terms: BlockRentTerms = {
      ...LONG_TERM,
      rates: [{ fromBlock: 0, dailyRateCents: 60_00, weeklyRateCents: null }],
    };
    expect(rentForBlocks(terms, { firstBlock: 0, endBlock: 7 })).toBe(420_00);
  });

  it("follows a rate change from its week start", () => {
    const terms: BlockRentTerms = {
      ...LONG_TERM,
      rates: [...LONG_TERM.rates, { fromBlock: 7, dailyRateCents: 70_00, weeklyRateCents: 400_00 }],
    };
    expect(rentForBlocks(terms, { firstBlock: 0, endBlock: 7 })).toBe(350_00);
    expect(rentForBlocks(terms, { firstBlock: 7, endBlock: 14 })).toBe(400_00);
  });
});

describe("which periods are due", () => {
  it("charges a long-term week in advance, from the moment it starts", () => {
    expect(duePeriods(LONG_TERM, { currentBlock: 0, blocksUsed: null })).toEqual([
      { firstBlock: 0, endBlock: 7 },
    ]);
    expect(duePeriods(LONG_TERM, { currentBlock: 7, blocksUsed: null })).toHaveLength(2);
  });

  it("charges a short hire's booked blocks at once, then each extra block as it starts", () => {
    expect(duePeriods(SHORT_HIRE, { currentBlock: 0, blocksUsed: null })).toEqual([
      { firstBlock: 0, endBlock: 3 },
    ]);
    expect(duePeriods(SHORT_HIRE, { currentBlock: 4, blocksUsed: null })).toEqual([
      { firstBlock: 0, endBlock: 3 },
      { firstBlock: 3, endBlock: 4 },
      { firstBlock: 4, endBlock: 5 },
    ]);
  });

  it("starts no period at or after the return", () => {
    expect(duePeriods(LONG_TERM, { currentBlock: 9, blocksUsed: 7 })).toEqual([
      { firstBlock: 0, endBlock: 7 },
    ]);
  });
});

describe("what is owed once the car is back", () => {
  it("re-prices a long-term rental that ended below the minimum, unless waived", () => {
    expect(isRepricedAtDailyRate(LONG_TERM, 3)).toBe(true);
    expect(owedForPeriod(LONG_TERM, { firstBlock: 0, endBlock: 7 }, 3)).toBe(210_00);
    const waived = { ...LONG_TERM, isDailyRateWaived: true };
    expect(isRepricedAtDailyRate(waived, 3)).toBe(false);
    expect(owedForPeriod(waived, { firstBlock: 0, endBlock: 7 }, 3)).toBe(150_00);
  });

  it("keeps the long-term price once the minimum is reached", () => {
    expect(isRepricedAtDailyRate(LONG_TERM, 7)).toBe(false);
    expect(owedForPeriod(LONG_TERM, { firstBlock: 7, endBlock: 14 }, 10)).toBe(150_00);
  });

  it("owes nothing for a period that starts at or after the return", () => {
    expect(owedForPeriod(LONG_TERM, { firstBlock: 28, endBlock: 35 }, 28)).toBe(0);
  });
});

describe("the lines the run adds", () => {
  it("charges a 4-week booking returned on time exactly 4 weeks (review A4-1)", () => {
    // The run charged week 5 at its start, then the car came back 30 minutes later.
    const charged = runUntilSettled(LONG_TERM, [
      ...[0, 7, 14, 21, 28].map((currentBlock) => ({ currentBlock, blocksUsed: null })),
      { currentBlock: 28, blocksUsed: blocksBetween(HANDOVER, at(672.5), 60) },
    ]);
    expect(netCents(charged)).toBe(4 * 350_00);
    expect(charged.at(-1)).toMatchObject({
      kind: "credit",
      amountCents: 350_00,
      isCorrection: true,
    });
  });

  it("credits the unused blocks of a week after an early return", () => {
    const charged = runUntilSettled(LONG_TERM, [
      { currentBlock: 7, blocksUsed: null },
      { currentBlock: 10, blocksUsed: 10 },
    ]);
    expect(netCents(charged)).toBe(350_00 + 150_00);
  });

  it("re-prices a long-term booking returned after 3 days, then waiving undoes it", () => {
    const repriced = runUntilSettled(LONG_TERM, [
      { currentBlock: 0, blocksUsed: null },
      { currentBlock: 2, blocksUsed: 3 },
    ]);
    expect(netCents(repriced)).toBe(210_00);
    const waived = { ...LONG_TERM, isDailyRateWaived: true };
    const after = [
      ...repriced,
      ...asCharged(rentLinesToAdd(waived, { currentBlock: 2, blocksUsed: 3 }, repriced)),
    ];
    expect(netCents(after)).toBe(150_00);
  });

  it("charges a short hire kept 2 days late for the extra blocks only", () => {
    const charged = runUntilSettled(SHORT_HIRE, [
      { currentBlock: 0, blocksUsed: null },
      { currentBlock: 3, blocksUsed: null },
      { currentBlock: 4, blocksUsed: null },
      { currentBlock: 4, blocksUsed: 5 },
    ]);
    expect(netCents(charged)).toBe(5 * 70_00);
  });

  it("credits a short hire returned a day early", () => {
    const charged = runUntilSettled(SHORT_HIRE, [
      { currentBlock: 0, blocksUsed: null },
      { currentBlock: 1, blocksUsed: 2 },
    ]);
    expect(netCents(charged)).toBe(2 * 70_00);
  });

  it("charges a car back before its first charge only for what it used", () => {
    expect(rentLinesToAdd(SHORT_HIRE, { currentBlock: 0, blocksUsed: 1 }, [])).toEqual([
      expect.objectContaining({ kind: "charge", amountCents: 70_00, isCorrection: false }),
    ]);
  });

  it("leaves a week alone once the business has reversed a line of it (review A4-3)", () => {
    const charged = asCharged(rentLinesToAdd(LONG_TERM, { currentBlock: 0, blocksUsed: null }, []));
    const waivedWeek = charged.map((line) => ({ ...line, isReversed: true }));
    expect(rentLinesToAdd(LONG_TERM, { currentBlock: 3, blocksUsed: 3 }, waivedWeek)).toEqual([]);
  });

  it("gives a correction the GST treatment of the line it corrects", () => {
    const untaxed: ChargedRentLine[] = [
      {
        kind: "charge",
        periodFirstBlock: 0,
        amountCents: 350_00,
        gstCents: 0,
        isCorrection: false,
        isReversed: false,
      },
    ];
    const waived = { ...LONG_TERM, isDailyRateWaived: true };
    const backAfterThreeDays = { currentBlock: 2, blocksUsed: 3 };
    expect(rentLinesToAdd(waived, backAfterThreeDays, untaxed)).toEqual([
      expect.objectContaining({ kind: "credit", amountCents: 200_00, correctionGstCents: 0 }),
    ]);
    const taxed = untaxed.map((line) => ({ ...line, gstCents: 31_82 }));
    expect(rentLinesToAdd(waived, backAfterThreeDays, taxed)).toEqual([
      expect.objectContaining({ kind: "credit", amountCents: 200_00, correctionGstCents: 18_18 }),
    ]);
  });
});

describe("rate changes", () => {
  it("offers the week starts after the week now running", () => {
    expect(upcomingWeekStarts(3, 3)).toEqual([7, 14, 21]);
    expect(upcomingWeekStarts(7, 1)).toEqual([14]);
  });

  it("refuses a short hire, a mid-week start, a past start, a week with a rate, or no change", () => {
    const change = { fromBlock: 14, weeklyRateCents: 400_00 };
    expect(blockRateChangeProblem(SHORT_HIRE, change, 3)).toBe("not_long_term");
    expect(blockRateChangeProblem(LONG_TERM, { ...change, fromBlock: 10 }, 3)).toBe(
      "not_week_start",
    );
    expect(blockRateChangeProblem(LONG_TERM, change, 14)).toBe("too_soon");
    const withRate: BlockRentTerms = {
      ...LONG_TERM,
      rates: [
        ...LONG_TERM.rates,
        { fromBlock: 14, dailyRateCents: 70_00, weeklyRateCents: 380_00 },
      ],
    };
    expect(blockRateChangeProblem(withRate, change, 3)).toBe("already_has_rate");
    expect(blockRateChangeProblem(LONG_TERM, { ...change, weeklyRateCents: 350_00 }, 3)).toBe(
      "unchanged",
    );
    expect(blockRateChangeProblem(LONG_TERM, change, 3)).toBeNull();
  });

  it("compares with the rate that week would have, not today's (review G2-5)", () => {
    const discountEnding: BlockRentTerms = {
      ...LONG_TERM,
      rates: [...LONG_TERM.rates, { fromBlock: 7, dailyRateCents: 70_00, weeklyRateCents: 300_00 }],
    };
    expect(
      blockRateChangeProblem(discountEnding, { fromBlock: 14, weeklyRateCents: 350_00 }, 3),
    ).toBeNull();
  });

  it("starts a rise for a direct-debit Renter no sooner than the notice allows, and a fall any week", () => {
    // LONG_TERM is $350 a week; the notice ends at block 35.
    expect(
      blockRateChangeProblem(LONG_TERM, { fromBlock: 14, weeklyRateCents: 380_00 }, 3, 35),
    ).toBe("needs_notice");
    expect(
      blockRateChangeProblem(LONG_TERM, { fromBlock: 35, weeklyRateCents: 380_00 }, 3, 35),
    ).toBeNull();
    expect(
      blockRateChangeProblem(LONG_TERM, { fromBlock: 14, weeklyRateCents: 320_00 }, 3, 35),
    ).toBeNull();
    expect(
      blockRateChangeProblem(LONG_TERM, { fromBlock: 14, weeklyRateCents: 380_00 }, 3, null),
    ).toBeNull();
  });

  it("can't be signed once its week has started", () => {
    expect(isBlockRateChangeSignable(HANDOVER, 7, at(167))).toBe(true);
    expect(isBlockRateChangeSignable(HANDOVER, 7, at(168))).toBe(false);
    expect(isBlockRateChangeSignable(HANDOVER, 7, new Date(at(168).getTime() + MINUTE))).toBe(
      false,
    );
  });
});

describe("the next rent", () => {
  const ONGOING_TERMS: BlockRentTerms = { ...LONG_TERM, bookedBlocks: 0 };
  const out = (currentBlock: number) => ({ currentBlock, blocksUsed: null });
  /** What the run has charged by a block: every line it adds up to then. */
  const chargedBy = (terms: BlockRentTerms, currentBlock: number) =>
    runUntilSettled(terms, [out(currentBlock)]);

  it("is a booking's first week, or a short hire's booked days at the daily rate", () => {
    expect(firstRentOf(LONG_TERM)).toEqual({
      period: { firstBlock: 0, endBlock: 7 },
      amountCents: 350_00,
    });
    expect(firstRentOf(SHORT_HIRE)).toEqual({
      period: { firstBlock: 0, endBlock: 3 },
      amountCents: 210_00,
    });
  });

  it("is the next week once this one is charged, the same day of the week as the handover", () => {
    expect(nextRentOf(ONGOING_TERMS, out(0), chargedBy(ONGOING_TERMS, 0), null)).toEqual({
      period: { firstBlock: 7, endBlock: 14 },
      amountCents: 350_00,
    });
    // The last block of a week: still the week after it.
    expect(nextRentOf(ONGOING_TERMS, out(13), chargedBy(ONGOING_TERMS, 13), null)?.period).toEqual({
      firstBlock: 14,
      endBlock: 21,
    });
  });

  it("is a week already started that tonight's run has not charged yet", () => {
    expect(nextRentOf(ONGOING_TERMS, out(7), chargedBy(ONGOING_TERMS, 6), null)?.period).toEqual({
      firstBlock: 7,
      endBlock: 14,
    });
  });

  it("is exactly what the run then charges, at the rate in force that week", () => {
    const terms: BlockRentTerms = {
      ...ONGOING_TERMS,
      rates: [
        ...ONGOING_TERMS.rates,
        { fromBlock: 14, dailyRateCents: 70_00, weeklyRateCents: 315_05 },
      ],
    };
    const next = nextRentOf(terms, out(8), chargedBy(terms, 8), null);
    const runAdds = rentLinesToAdd(terms, out(14), chargedBy(terms, 8));

    expect(next).toEqual({ period: { firstBlock: 14, endBlock: 21 }, amountCents: 315_05 });
    expect(runAdds.map((line) => ({ period: line.period, amountCents: line.amountCents }))).toEqual(
      [next],
    );
  });

  it("stops at a fixed rental's end: none once every week before it is charged", () => {
    const fourWeeks: BlockRentTerms = { ...LONG_TERM, bookedBlocks: 28 };

    expect(nextRentOf(fourWeeks, out(20), chargedBy(fourWeeks, 20), 28)?.period.firstBlock).toBe(
      21,
    );
    expect(nextRentOf(fourWeeks, out(22), chargedBy(fourWeeks, 22), 28)).toBeNull();
    // Booked for 30 days: the fifth week starts before the end, so it is still to come.
    expect(nextRentOf(fourWeeks, out(22), chargedBy(fourWeeks, 22), 30)?.period.firstBlock).toBe(
      28,
    );
  });

  it("carries on after a fixed end while the car is late back, as the run does", () => {
    const fourWeeks: BlockRentTerms = { ...LONG_TERM, bookedBlocks: 28 };

    expect(nextRentOf(fourWeeks, out(29), chargedBy(fourWeeks, 29), 28)).toEqual({
      period: { firstBlock: 35, endBlock: 42 },
      amountCents: 350_00,
    });
  });

  it("is none for a short hire paid up front, then a day at a time once it is late back", () => {
    expect(nextRentOf(SHORT_HIRE, out(1), chargedBy(SHORT_HIRE, 1), 3)).toBeNull();
    expect(nextRentOf(SHORT_HIRE, out(3), chargedBy(SHORT_HIRE, 2), 3)).toEqual({
      period: { firstBlock: 3, endBlock: 4 },
      amountCents: 70_00,
    });
  });

  it("is none once the car is back: only corrections follow", () => {
    expect(
      nextRentOf(
        ONGOING_TERMS,
        { currentBlock: 9, blocksUsed: 9 },
        chargedBy(ONGOING_TERMS, 8),
        null,
      ),
    ).toBeNull();
  });

  it("skips a week the business changed by hand, as the run does", () => {
    const charged = chargedBy(ONGOING_TERMS, 7).map((line) =>
      line.periodFirstBlock === 7 ? { ...line, isReversed: true } : line,
    );

    expect(nextRentOf(ONGOING_TERMS, out(8), charged, null)?.period.firstBlock).toBe(14);
  });
});
