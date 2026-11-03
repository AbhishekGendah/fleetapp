import { formatCents } from "@fleetapp/core";

/** "Owing $950.00", "In credit $20.00" or "Nothing owing". */
export function balanceText(balanceCents: number): string {
  if (balanceCents > 0) {
    return `Owing ${formatCents(balanceCents)}`;
  }
  return balanceCents < 0 ? `In credit ${formatCents(-balanceCents)}` : "Nothing owing";
}
