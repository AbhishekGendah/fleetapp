/**
 * A car's purchase, sale and other costs (docs/plans/phase-2-step-2.md, 2b).
 * All amounts include GST, with the GST beside them (rule 9).
 */

/** A private seller charges no GST; a dealer does. */
export const PURCHASE_SOURCES = ["dealer", "private"] as const;
export type PurchaseSource = (typeof PURCHASE_SOURCES)[number];

export const PURCHASE_SOURCE_LABELS: Readonly<Record<PurchaseSource, string>> = {
  dealer: "Dealer",
  private: "Private seller",
};

/** Takes any text, as the form's box holds it before it is checked. */
export function isPrivatePurchase(source: string): boolean {
  return source === "private";
}

/** Refurb counts towards the car's cost base for the profit report later. */
export const VEHICLE_COST_KINDS = ["refurb", "repair", "other"] as const;
export type VehicleCostKind = (typeof VEHICLE_COST_KINDS)[number];

export const VEHICLE_COST_KIND_LABELS: Readonly<Record<VehicleCostKind, string>> = {
  refurb: "Refurb",
  repair: "Repair",
  other: "Other",
};

export interface AmountWithGst {
  amountCents: number;
  gstCents: number;
}

export interface CarMoneyRecords {
  purchase: AmountWithGst | null;
  costs: readonly (AmountWithGst & { kind: VehicleCostKind })[];
  sale: AmountWithGst | null;
}

export interface CarMoneyTotals {
  bought: AmountWithGst | null;
  refurb: AmountWithGst;
  otherCosts: AmountWithGst;
  sold: AmountWithGst | null;
  /**
   * Sold minus bought and costs, all without their GST: GST paid is claimed
   * back and GST charged is passed on, so neither is the Operator's. Null
   * until the car is both bought and sold.
   */
  differenceExcludingGstCents: number | null;
}

const NOTHING: AmountWithGst = { amountCents: 0, gstCents: 0 };

function sumOf(amounts: readonly AmountWithGst[]): AmountWithGst {
  return amounts.reduce(
    (total, each) => ({
      amountCents: total.amountCents + each.amountCents,
      gstCents: total.gstCents + each.gstCents,
    }),
    NOTHING,
  );
}

function excludingGst(amount: AmountWithGst): number {
  return amount.amountCents - amount.gstCents;
}

/** The Costs tab's totals, worked out each time from the records, never stored. */
export function carMoneyTotals(records: CarMoneyRecords): CarMoneyTotals {
  const refurb = sumOf(records.costs.filter((cost) => cost.kind === "refurb"));
  const otherCosts = sumOf(records.costs.filter((cost) => cost.kind !== "refurb"));
  const { purchase, sale } = records;
  return {
    bought: purchase,
    refurb,
    otherCosts,
    sold: sale,
    differenceExcludingGstCents:
      purchase && sale
        ? excludingGst(sale) -
          excludingGst(purchase) -
          excludingGst(refurb) -
          excludingGst(otherCosts)
        : null,
  };
}
