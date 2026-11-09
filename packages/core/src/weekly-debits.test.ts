import { describe, expect, it } from "vitest";

import {
  debitDescription,
  debitFailureText,
  debitPlansOffered,
  debitRecoveryStep,
  firstWeekAfterNotice,
  instalmentShares,
  isRateRise,
  isRentWeekDebitable,
  rentWeekCents,
  scheduledDebitCents,
  signedRateChangeStartBlock,
  type PeriodLedgerLine,
} from "./weekly-debits";

const DAY_MS = 24 * 60 * 60 * 1000;
const HANDED_OVER = new Date("2026-11-03T01:00:00Z");
const WEEK_2 = new Date(HANDED_OVER.getTime() + 7 * DAY_MS);

describe("splitting a one-off charge over weekly debits", () => {
  it("adds back to the charge exactly, odd cents first", () => {
    expect(instalmentShares(100_00, 3)).toEqual([33_34, 33_33, 33_33]);
    expect(instalmentShares(100_02, 3)).toEqual([33_34, 33_34, 33_34]);
    expect(instalmentShares(1_00, 12).reduce((sum, cents) => sum + cents, 0)).toBe(1_00);
  });
});

describe("the plans a one-off charge can take", () => {
  it("offers the weekly ones only while the car is out", () => {
    expect(debitPlansOffered(true)).toEqual(["not_debited", "next_debit", "own_debit", "split"]);
    expect(debitPlansOffered(false)).toEqual(["not_debited", "own_debit"]);
  });
});

describe("which rent weeks are debited", () => {
  const base = { handedOverAt: HANDED_OVER, resumedAt: null };

  it("debits a week that started in the last 7 days, never the first week", () => {
    expect(isRentWeekDebitable({ ...base, weekStartsAt: WEEK_2, now: WEEK_2 })).toBe(true);
    expect(
      isRentWeekDebitable({
        ...base,
        weekStartsAt: HANDED_OVER,
        now: new Date(HANDED_OVER.getTime() + DAY_MS),
      }),
    ).toBe(false);
  });

  it("leaves a week over 7 days old owing, to the millisecond", () => {
    const justInside = new Date(WEEK_2.getTime() + 7 * DAY_MS - 1);
    const justOutside = new Date(WEEK_2.getTime() + 7 * DAY_MS);
    expect(isRentWeekDebitable({ ...base, weekStartsAt: WEEK_2, now: justInside })).toBe(true);
    expect(isRentWeekDebitable({ ...base, weekStartsAt: WEEK_2, now: justOutside })).toBe(false);
  });

  it("never debits a week before it starts, nor one begun while paused", () => {
    expect(
      isRentWeekDebitable({ ...base, weekStartsAt: WEEK_2, now: new Date(WEEK_2.getTime() - 1) }),
    ).toBe(false);
    expect(
      isRentWeekDebitable({
        ...base,
        weekStartsAt: WEEK_2,
        now: new Date(WEEK_2.getTime() + DAY_MS),
        resumedAt: new Date(WEEK_2.getTime() + 60_000),
      }),
    ).toBe(false);
  });

  it("counts exact 24-hour blocks across a daylight-saving change (debited once)", () => {
    // Sydney moves its clocks forward on 4 Oct 2026; blocks are exact hours, not local days.
    const handedOver = new Date("2026-09-30T23:00:00Z");
    const week2 = new Date(handedOver.getTime() + 7 * DAY_MS);
    expect(
      isRentWeekDebitable({
        handedOverAt: handedOver,
        resumedAt: null,
        weekStartsAt: week2,
        now: week2,
      }),
    ).toBe(true);
    expect(
      debitDescription({ kind: "rent", weekStartsAt: week2 }, "1BRT482", "Australia/Sydney"),
    ).toBe("Rent 1BRT482, week from Thu 8 Oct 2026");
  });
});

describe("a rent week's rent as it stands", () => {
  const line = (
    id: string,
    kind: PeriodLedgerLine["kind"],
    cents: number,
    at: Date | null,
    reversesId: string | null = null,
  ): PeriodLedgerLine => ({
    id,
    kind,
    amountCents: cents,
    periodStartsAt: at,
    reversesId,
  });

  it("is the week's charge plus its corrections, less any reversed", () => {
    const lines = [
      line("rent", "charge", 350_00, WEEK_2),
      line("other-week", "charge", 350_00, HANDED_OVER),
      line("credit", "credit", 50_00, WEEK_2),
      line("extra", "charge", 20_00, WEEK_2),
      line("undo-extra", "reversal", 20_00, null, "extra"),
    ];
    expect(rentWeekCents(lines, WEEK_2)).toBe(300_00);
  });
});

describe("the scheduled amount of a debit", () => {
  it("takes what was planned when that much is owing", () => {
    expect(scheduledDebitCents({ plannedCents: 350_00, owingCents: 700_00, pendingCents: 0 })).toBe(
      350_00,
    );
  });

  it("is capped at what is owing less what is pending (the Renter paid cash)", () => {
    expect(scheduledDebitCents({ plannedCents: 350_00, owingCents: 200_00, pendingCents: 0 })).toBe(
      200_00,
    );
    expect(
      scheduledDebitCents({ plannedCents: 350_00, owingCents: 500_00, pendingCents: 350_00 }),
    ).toBe(150_00);
  });

  it("is nothing under 50c, and nothing for a Renter in credit", () => {
    expect(scheduledDebitCents({ plannedCents: 350_00, owingCents: 49, pendingCents: 0 })).toBe(0);
    expect(scheduledDebitCents({ plannedCents: 350_00, owingCents: 50, pendingCents: 0 })).toBe(50);
    expect(
      scheduledDebitCents({ plannedCents: 350_00, owingCents: -100_00, pendingCents: 0 }),
    ).toBe(0);
  });
});

describe("the 30 days' notice of a rate rise", () => {
  it("is for a rise only", () => {
    expect(isRateRise(350_00, 380_00)).toBe(true);
    expect(isRateRise(350_00, 320_00)).toBe(false);
    expect(isRateRise(null, 320_00)).toBe(false);
  });

  it("finds the first rent week starting 30 days on", () => {
    // 30 days after the handover is block 30: the first week start at or after it is block 35.
    expect(firstWeekAfterNotice(HANDED_OVER, HANDED_OVER)).toBe(35);
    expect(firstWeekAfterNotice(HANDED_OVER, new Date(HANDED_OVER.getTime() + 5 * DAY_MS))).toBe(
      35,
    );
    expect(
      firstWeekAfterNotice(HANDED_OVER, new Date(HANDED_OVER.getTime() + 5 * DAY_MS + 1)),
    ).toBe(42);
  });

  it("moves a rise signed late to that week, and leaves a fall as proposed", () => {
    const signedAt = new Date(HANDED_OVER.getTime() + 10 * DAY_MS);
    const moved = { handedOverAt: HANDED_OVER, proposedFromBlock: 35, signedAt };
    expect(signedRateChangeStartBlock({ ...moved, needsNotice: true })).toBe(42);
    expect(signedRateChangeStartBlock({ ...moved, needsNotice: false })).toBe(35);
    expect(signedRateChangeStartBlock({ ...moved, proposedFromBlock: 56, needsNotice: true })).toBe(
      56,
    );
  });
});

describe("what a debit says", () => {
  it("names the car and the week in the business's timezone, never a person", () => {
    expect(
      debitDescription({ kind: "rent", weekStartsAt: WEEK_2 }, "1BRT482", "Australia/Sydney"),
    ).toBe("Rent 1BRT482, week from Tue 10 Nov 2026");
    // 8pm UTC on 9 Nov is already the 10th in Perth and Sydney: the business's day, not UTC's.
    expect(
      debitDescription(
        { kind: "rent", weekStartsAt: new Date("2026-11-09T20:00:00Z") },
        "1BRT482",
        "Australia/Perth",
      ),
    ).toBe("Rent 1BRT482, week from Tue 10 Nov 2026");
    expect(
      debitDescription(
        { kind: "rent", weekStartsAt: new Date("2026-11-09T20:00:00Z") },
        "1BRT482",
        "Australia/Sydney",
      ),
    ).toBe("Rent 1BRT482, week from Tue 10 Nov 2026");
    expect(
      debitDescription({ kind: "one_off", requestedAt: WEEK_2 }, "1BRT482", "Australia/Perth"),
    ).toBe("Charges 1BRT482, Tue 10 Nov 2026");
  });

  it("puts Stripe's reasons in plain words", () => {
    expect(debitFailureText("insufficient_funds")).toBe("Not enough money in the account");
    expect(debitFailureText("amount_too_large")).toBe("Over your Stripe direct-debit limit");
    expect(debitFailureText("something_new")).toBe("The bank did not pay it");
    expect(debitFailureText(null)).toBe("The bank did not pay it");
  });
});

describe("recovering a debit whose answer was never saved", () => {
  const requestedAt = new Date("2026-11-10T18:00:00Z");
  const after = (ms: number) => new Date(requestedAt.getTime() + ms);

  it("leaves one under 15 minutes old, asks again within 23 hours, then looks it up", () => {
    expect(debitRecoveryStep(requestedAt, after(14 * 60_000))).toBe("wait");
    expect(debitRecoveryStep(requestedAt, after(15 * 60_000))).toBe("ask_again");
    expect(debitRecoveryStep(requestedAt, after(23 * 60 * 60_000 - 1))).toBe("ask_again");
    expect(debitRecoveryStep(requestedAt, after(23 * 60 * 60_000))).toBe("look_up");
  });
});
