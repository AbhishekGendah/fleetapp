import { describe, expect, it } from "vitest";

import { businessStatementFigures } from "./business-statement";
import { ledgerBalanceCents, statementFigures, type DatedLedgerLine } from "./ledger";

type Line = DatedLedgerLine & { rentalId: string };

function line(
  rentalId: string,
  id: string,
  kind: Line["kind"],
  amountCents: number,
  effectiveOn: string,
  reversesId: string | null = null,
): Line {
  return { rentalId, id, kind, amountCents, effectiveOn, reversesId };
}

/**
 * Three cars of one business: one behind (its debit failed), one paid up,
 * one in credit after a part-week credit, with a reversal and a refund.
 */
const LINES: Line[] = [
  line("camry", "c-rent-1", "charge", 380_00, "2026-10-12"),
  line("camry", "c-paid-1", "payment", 380_00, "2026-10-12"),
  line("camry", "c-rent-2", "charge", 380_00, "2026-11-02"),
  line("cerato", "k-rent-1", "charge", 360_00, "2026-10-12"),
  line("cerato", "k-paid-1", "payment", 360_00, "2026-10-14"),
  line("cerato", "k-clean", "charge", 80_00, "2026-10-20"),
  line("cerato", "k-undo-clean", "reversal", 80_00, "2026-10-21", "k-clean"),
  line("corolla", "o-rent-1", "charge", 340_00, "2026-10-30"),
  line("corolla", "o-paid-1", "payment", 340_00, "2026-10-30"),
  line("corolla", "o-credit", "credit", 97_14, "2026-11-04"),
  line("corolla", "o-paid-2", "payment", 340_00, "2026-11-04"),
  line("corolla", "o-refund", "refund", 100_00, "2026-11-05"),
];

const ofRental = (rentalId: string) => LINES.filter((item) => item.rentalId === rentalId);

describe("a business's statement across its cars", () => {
  const figures = businessStatementFigures(LINES, "2026-10-01", "2026-11-30");

  it("adds up to the business's whole ledger, to the cent", () => {
    expect(figures.closingCents).toBe(ledgerBalanceCents(LINES));
    expect(figures.openingCents + figures.chargedCents - figures.paidCents).toBe(
      figures.closingCents,
    );
  });

  it("is the sum of each rental's own statement", () => {
    for (const car of figures.cars) {
      const own = statementFigures(ofRental(car.rentalId), "2026-10-01", "2026-11-30");
      expect(car.closingCents).toBe(own.closingCents);
      expect(car.openingCents + car.chargedCents - car.paidCents).toBe(car.closingCents);
    }
    expect(figures.cars.reduce((total, car) => total + car.closingCents, 0)).toBe(
      figures.closingCents,
    );
  });

  it("keeps one car's credit from hiding another car's arrears", () => {
    const owing = Object.fromEntries(figures.cars.map((car) => [car.rentalId, car.closingCents]));
    expect(owing).toEqual({ camry: 380_00, cerato: 0, corolla: -(97_14 - 100_00) - 340_00 });
    expect(owing.camry).toBeGreaterThan(0);
    expect(owing.corolla).toBeLessThan(0);
  });

  it("lists the cars in the order they were rented, each line once, under charged or paid", () => {
    expect(figures.cars.map((car) => car.rentalId)).toEqual(["camry", "cerato", "corolla"]);
    expect(figures.cars.flatMap((car) => car.entries.map((entry) => entry.line.id))).toEqual(
      LINES.map((item) => item.id),
    );
    const cerato = figures.cars[1]!;
    expect(cerato.entries.map((entry) => [entry.chargedCents, entry.paidCents])).toEqual([
      [360_00, 0],
      [0, 360_00],
      [80_00, 0],
      [0, 80_00],
    ]);
    const corolla = figures.cars[2]!;
    expect(corolla.entries.at(-1)).toMatchObject({ chargedCents: 100_00, paidCents: 0 });
  });

  it("brings each car's balance forward into a later range, and leaves out a car with none", () => {
    const november = businessStatementFigures(LINES, "2026-11-01", "2026-11-30");

    expect(november.cars.map((car) => [car.rentalId, car.openingCents])).toEqual([
      ["camry", 0],
      ["corolla", 0],
    ]);
    const late = businessStatementFigures(LINES, "2026-11-06", "2026-11-30");
    expect(late.cars.map((car) => [car.rentalId, car.openingCents, car.entries.length])).toEqual([
      ["camry", 380_00, 0],
      ["corolla", -(97_14 - 100_00) - 340_00, 0],
    ]);
    expect(late.closingCents).toBe(ledgerBalanceCents(LINES));
  });

  it("is empty with no lines", () => {
    expect(businessStatementFigures([], "2026-11-01", "2026-11-30")).toEqual({
      cars: [],
      openingCents: 0,
      chargedCents: 0,
      paidCents: 0,
      closingCents: 0,
    });
  });
});
