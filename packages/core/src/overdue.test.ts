import { describe, expect, it } from "vitest";

import { todayInTimeZone } from "./calendar-dates";
import type { DatedLedgerLine } from "./ledger";
import { DEFAULT_PAYMENT_GRACE_DAYS, overdueOf } from "./overdue";
import { operatorSettingsSchema, readSettings } from "./settings";

const GRACE_DAYS = 2;
const RENT = 350_00;
const SYDNEY = "Australia/Sydney";

function line(
  id: string,
  kind: DatedLedgerLine["kind"],
  amountCents: number,
  effectiveOn: string,
  reversesId: string | null = null,
): DatedLedgerLine {
  return { id, kind, amountCents, effectiveOn, reversesId };
}

describe("overdue", () => {
  it("is nothing with no charges at all", () => {
    expect(overdueOf([], "2026-11-07", GRACE_DAYS)).toBeNull();
  });

  it("is nothing once paid in full", () => {
    const lines = [
      line("rent", "charge", RENT, "2026-10-01"),
      line("paid", "payment", RENT, "2026-10-20"),
    ];

    expect(overdueOf(lines, "2026-11-07", GRACE_DAYS)).toBeNull();
  });

  it("counts what is left of a part-paid charge, late from its own due day", () => {
    const lines = [
      line("rent", "charge", RENT, "2026-10-29"),
      line("paid", "payment", 100_00, "2026-10-30"),
    ];

    expect(overdueOf(lines, "2026-11-07", GRACE_DAYS)).toEqual({
      overdueCents: 250_00,
      daysLate: 9,
      oldestDueOn: "2026-10-29",
    });
  });

  it("is not overdue on the last grace day, and is the day after", () => {
    const lines = [line("rent", "charge", RENT, "2026-11-05")];

    expect(overdueOf(lines, "2026-11-07", GRACE_DAYS)).toBeNull();
    expect(overdueOf(lines, "2026-11-08", GRACE_DAYS)).toEqual({
      overdueCents: RENT,
      daysLate: 3,
      oldestDueOn: "2026-11-05",
    });
  });

  it("with no grace days, is overdue the day after it was due, never on the day", () => {
    const lines = [line("rent", "charge", RENT, "2026-11-07")];

    expect(overdueOf(lines, "2026-11-07", 0)).toBeNull();
    expect(overdueOf(lines, "2026-11-08", 0)?.daysLate).toBe(1);
  });

  it("adds up every charge past its grace, but not a newer one still inside it", () => {
    const lines = [
      line("week-1", "charge", RENT, "2026-10-24"),
      line("week-2", "charge", RENT, "2026-10-31"),
      line("week-3", "charge", RENT, "2026-11-06"),
      line("paid", "payment", 50_00, "2026-10-25"),
    ];

    expect(overdueOf(lines, "2026-11-07", GRACE_DAYS)).toEqual({
      overdueCents: 650_00,
      daysLate: 14,
      oldestDueOn: "2026-10-24",
    });
  });

  it("leaves out a reversed charge (and its reversal)", () => {
    const lines = [
      line("wrong", "charge", RENT, "2026-10-01"),
      line("undo", "reversal", RENT, "2026-10-02", "wrong"),
      line("rent", "charge", 100_00, "2026-11-01"),
    ];

    expect(overdueOf(lines, "2026-11-07", GRACE_DAYS)).toEqual({
      overdueCents: 100_00,
      daysLate: 6,
      oldestDueOn: "2026-11-01",
    });
  });

  it("brings a charge back when the payment that covered it is reversed", () => {
    const lines = [
      line("rent", "charge", RENT, "2026-10-01"),
      line("paid", "payment", RENT, "2026-10-02"),
      line("bounced", "reversal", RENT, "2026-11-06", "paid"),
    ];

    expect(overdueOf(lines, "2026-11-07", GRACE_DAYS)?.overdueCents).toBe(RENT);
  });

  it("is nothing when a credit covers the charge, or leaves the Renter in credit", () => {
    const covered = [
      line("rent", "charge", RENT, "2026-10-01"),
      line("goodwill", "credit", RENT, "2026-10-03"),
    ];
    const inCredit = [...covered, line("extra", "credit", 20_00, "2026-10-04")];

    expect(overdueOf(covered, "2026-11-07", GRACE_DAYS)).toBeNull();
    expect(overdueOf(inCredit, "2026-11-07", GRACE_DAYS)).toBeNull();
  });

  it("counts a refund that raises the balance from the day it was made", () => {
    const lines = [
      line("rent", "charge", RENT, "2026-10-01"),
      line("paid", "payment", 400_00, "2026-10-02"),
      // Refunding $80.00 of a $50.00 overpayment leaves $30.00 owing from 3 Nov.
      line("refund", "refund", 80_00, "2026-11-03"),
    ];

    expect(overdueOf(lines, "2026-11-07", GRACE_DAYS)).toEqual({
      overdueCents: 30_00,
      daysLate: 4,
      oldestDueOn: "2026-11-03",
    });
    expect(overdueOf(lines, "2026-11-05", GRACE_DAYS)).toBeNull();
  });

  it("goes by the business's own day: the grace ends at their midnight, not UTC's", () => {
    const lines = [line("rent", "charge", RENT, "2026-11-02")];
    // 1pm UTC on 4 Nov is midnight starting 5 Nov in Sydney (daylight time, UTC+11).
    const lastGraceMoment = new Date("2026-11-04T12:59:59Z");
    const firstLateMoment = new Date("2026-11-04T13:00:00Z");

    expect(overdueOf(lines, todayInTimeZone(lastGraceMoment, SYDNEY), GRACE_DAYS)).toBeNull();
    expect(overdueOf(lines, todayInTimeZone(firstLateMoment, SYDNEY), GRACE_DAYS)).toEqual({
      overdueCents: RENT,
      daysLate: 3,
      oldestDueOn: "2026-11-02",
    });
  });
});

describe("the grace days setting", () => {
  it("is 2 days unless changed, a whole number from 0 to 30", () => {
    expect(readSettings(operatorSettingsSchema, {}).paymentGraceDays).toBe(
      DEFAULT_PAYMENT_GRACE_DAYS,
    );
    expect(DEFAULT_PAYMENT_GRACE_DAYS).toBe(2);
    for (const allowed of [0, 30]) {
      expect(operatorSettingsSchema.safeParse({ paymentGraceDays: allowed }).success).toBe(true);
    }
    for (const refused of [-1, 31, 1.5, "2"]) {
      expect(operatorSettingsSchema.safeParse({ paymentGraceDays: refused }).success).toBe(false);
    }
  });
});
