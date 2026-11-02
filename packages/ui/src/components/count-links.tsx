import { AUSTRALIAN_LOCALE } from "@fleetapp/core";
import type * as React from "react";

import { cn } from "../lib/utils";

export interface CountLink {
  href: string;
  label: string;
  count: number;
  /** The one whose list is showing now, filled in. */
  isCurrent?: boolean;
}

/**
 * Counts that open the list behind them, e.g. "Rented 72 · Available 9",
 * so a long list narrows to what matters in one tap (docs/design/09:
 * every number is tappable). Wraps onto as many lines as a phone needs;
 * each is at least a fingertip tall.
 */
export function CountLinks({
  links,
  label,
  className,
}: {
  links: readonly CountLink[];
  label: string;
  className?: string;
}): React.JSX.Element {
  return (
    <nav aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          aria-current={link.isCurrent ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
            link.isCurrent
              ? "border-teal bg-teal text-white"
              : "bg-card text-foreground hover:bg-muted border-border",
          )}
        >
          {link.label}
          <span className={cn("tabular-nums", link.isCurrent ? "" : "text-muted-foreground")}>
            {link.count.toLocaleString(AUSTRALIAN_LOCALE)}
          </span>
        </a>
      ))}
    </nav>
  );
}
