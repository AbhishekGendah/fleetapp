import { describe, expect, it } from "vitest";

import {
  bondHeldCents,
  bondHeldUntil,
  bondOwingCents,
  isBondShortForHandover,
  reversibleBondMovementIds,
  type BondMovementAmount,
} from "./bonds";

const received = (id: string, amountCents: number): BondMovementAmount => ({
  id,
  kind: "received",
  amountCents,
  reversesId: null,
});

describe("bonds", () => {
  it("holds what came in, less what went out", () => {
    const movements: BondMovementAmount[] = [
      received("a", 300_00),
      received("b", 200_00),
      { id: "c", kind: "deducted", amountCents: 150_00, reversesId: null },
      { id: "d", kind: "refunded", amountCents: 350_00, reversesId: null },
    ];

    expect(bondHeldCents(movements)).toBe(0);
    expect(bondHeldCents([])).toBe(0);
  });

  it("cancels a reversed entry exactly, whichever way it went", () => {
    const movements: BondMovementAmount[] = [
      received("a", 500_00),
      received("b", 50_00),
      { id: "c", kind: "reversal", amountCents: 50_00, reversesId: "b" },
      { id: "d", kind: "deducted", amountCents: 100_00, reversesId: null },
      { id: "e", kind: "reversal", amountCents: 100_00, reversesId: "d" },
    ];

    expect(bondHeldCents(movements)).toBe(500_00);
    expect([...reversibleBondMovementIds(movements)]).toEqual(["a"]);
  });

  it("refuses a reversal of a missing entry or of another reversal", () => {
    const orphan = { id: "x", kind: "reversal", amountCents: 1, reversesId: "nope" } as const;
    const ofReversal: BondMovementAmount[] = [
      received("a", 10_00),
      { id: "b", kind: "reversal", amountCents: 10_00, reversesId: "a" },
      { id: "c", kind: "reversal", amountCents: 10_00, reversesId: "b" },
    ];

    expect(() => bondHeldCents([orphan])).toThrow();
    expect(() => bondHeldCents(ofReversal)).toThrow();
  });

  it("owes the rest of the bond, never less than nothing", () => {
    expect(bondOwingCents(500_00, 200_00)).toBe(300_00);
    expect(bondOwingCents(500_00, 600_00)).toBe(0);
    expect(bondOwingCents(0, 0)).toBe(0);
  });

  it("is short for handover only when the rental's rules want it in full first", () => {
    const short = { requiredCents: 500_00, heldCents: 499_99 };

    expect(isBondShortForHandover({ ...short, isRequiredBeforeHandover: true })).toBe(true);
    expect(isBondShortForHandover({ ...short, isRequiredBeforeHandover: false })).toBe(false);
    expect(
      isBondShortForHandover({ requiredCents: 0, heldCents: 0, isRequiredBeforeHandover: true }),
    ).toBe(false);
  });
});

describe("how long the bond is kept after the return", () => {
  it("counts the hold days from the return day where the business is", () => {
    // 11:30pm on 2 Nov in Perth is still 2 Nov there, whatever the server says.
    expect(bondHeldUntil(new Date("2026-11-02T15:30:00Z"), 28, "Australia/Perth")).toBe(
      "2026-11-30",
    );
    expect(bondHeldUntil(new Date("2026-11-02T15:30:00Z"), 0, "Australia/Sydney")).toBe(
      "2026-11-03",
    );
  });
});

describe("a bond entry that came through Stripe", () => {
  it("can't be corrected here: only a refund in Stripe puts it right (review A5-3)", () => {
    const movements = [
      { id: "cash", kind: "received" as const, amountCents: 100_00, reversesId: null },
      {
        id: "card",
        kind: "received" as const,
        amountCents: 400_00,
        reversesId: null,
        isFromStripe: true,
      },
    ];
    expect([...reversibleBondMovementIds(movements)]).toEqual(["cash"]);
  });
});
