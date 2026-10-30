import * as React from "react";

import { cn } from "../lib/utils";

/** A list of records on a card, e.g. a car's rego renewals or costs. */
export function RecordList(props: { label?: string; children: React.ReactNode }) {
  return (
    <ul aria-label={props.label} className="flex flex-col gap-3">
      {props.children}
    </ul>
  );
}

interface RecordItemProps {
  title: React.ReactNode;
  /** Beside the title, e.g. a "Due soon" badge. */
  aside?: React.ReactNode;
  /** The money or number that matters most, shown larger. */
  amount?: React.ReactNode;
  /** Smaller lines under the title: dates, type, GST. */
  details?: React.ReactNode;
  /** Its buttons, along the bottom where a thumb reaches. */
  actions?: React.ReactNode;
  /** Anything else, e.g. its attached papers. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * One record as its own small card: what it is, its amount in larger text,
 * its details, then its buttons along the bottom. Easier to read and tap on
 * a phone than lines of small text.
 */
export function RecordItem(props: RecordItemProps) {
  return (
    <li
      className={cn(
        "bg-background flex flex-col gap-2 rounded-lg border p-3 sm:p-4",
        props.className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 font-semibold">{props.title}</p>
        {props.aside}
      </div>
      {props.amount ? <p className="text-primary text-lg font-bold">{props.amount}</p> : null}
      {props.details ? (
        <div className="text-muted-foreground flex flex-col gap-0.5 text-sm">{props.details}</div>
      ) : null}
      {props.children}
      {props.actions ? (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">{props.actions}</div>
      ) : null}
    </li>
  );
}
