import type * as React from "react";

import { cn } from "../lib/utils";

/**
 * What the badge says about its record: fine, worth a look, or a problem;
 * for a rental, out on rent or booked; a car free to rent; a Renter the
 * business will not rent to. Each differs from the others in lightness as
 * well as colour (rule 34): `available` is outlined on white, the lightest,
 * and `refused` solid dark red, the darkest. `kind` is not a status at all
 * but what a record is ("Business", "Driver for Acme Rides"): outlined in
 * grey, lighter than any status (7 Nov 2026 mockups).
 */
export type BadgeTone =
  "neutral" | "good" | "attention" | "danger" | "out" | "booked" | "available" | "refused" | "kind";

const TONE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-primary-soft text-primary",
  attention: "bg-attention-soft text-attention",
  danger: "bg-destructive-soft text-destructive",
  out: "bg-out-soft text-primary",
  booked: "bg-booked-soft text-booked",
  // An inset ring, so the outlined label is the same size as the filled ones.
  available: "bg-card text-teal-dark shadow-[inset_0_0_0_1.5px_var(--color-teal)]",
  refused: "bg-destructive-strong text-white",
  kind: "bg-card text-foreground shadow-[inset_0_0_0_1.5px_var(--color-muted-foreground)]",
};

/** A short label on a record, such as its status. */
export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
