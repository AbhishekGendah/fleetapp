import type * as React from "react";

import { cn } from "../lib/utils";

/**
 * What the badge says about its record: fine, worth a look, or a problem;
 * for a rental, out on rent or booked.
 */
export type BadgeTone = "neutral" | "good" | "attention" | "danger" | "out" | "booked";

const TONE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-primary-soft text-primary",
  attention: "bg-attention-soft text-attention",
  danger: "bg-destructive-soft text-destructive",
  out: "bg-out-soft text-primary",
  booked: "bg-booked-soft text-booked",
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
