import { formatCents } from "@fleetapp/core";
import { cn } from "@fleetapp/ui/cn";

export type BalanceTone = "owing" | "credit" | "settled";

/** Which way a balance points: owed to the business, owed to the Renter, or neither. */
export function balanceToneOf(balanceCents: number): BalanceTone {
  if (balanceCents > 0) return "owing";
  return balanceCents < 0 ? "credit" : "settled";
}

/**
 * Owing is red and bold, credit teal and bold (rule 34: weight as well as
 * colour), so the two can never be mistaken for each other.
 */
const BALANCE_TONE_CLASSES: Readonly<Record<BalanceTone, string>> = {
  owing: "text-destructive font-extrabold",
  credit: "text-teal font-bold",
  settled: "",
};

/** "$20.00 in credit", for a negative balance. */
export function creditText(balanceCents: number): string {
  return `${formatCents(-balanceCents)} in credit`;
}

/** "$450.00", "$0.00" or "$20.00 in credit": never a minus sign. */
export function balanceAmountText(balanceCents: number): string {
  return balanceToneOf(balanceCents) === "credit"
    ? creditText(balanceCents)
    : formatCents(balanceCents);
}

/** A balance in words, red when owed and teal when in credit (as on the Rentals list). */
export function BalanceText({ balanceCents, text }: { balanceCents: number; text: string }) {
  return (
    <span className={cn("tabular-nums", BALANCE_TONE_CLASSES[balanceToneOf(balanceCents)])}>
      {text}
    </span>
  );
}
