import type * as React from "react";

import { cn } from "../lib/utils";

/** What the badge says about its record: fine, worth a look, or a problem. */
export type BadgeTone = "neutral" | "good" | "attention" | "danger";

const TONE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-primary-soft text-teal",
  attention: "bg-attention-soft text-attention",
  danger: "bg-destructive/10 text-destructive",
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
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
