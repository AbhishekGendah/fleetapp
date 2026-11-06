import type * as React from "react";

import { cn } from "../lib/utils";

export interface SegmentedLink {
  href: string;
  label: string;
  /** A shorter or different name on a phone, e.g. "Day by day" for "Month". */
  phoneLabel?: string;
  isCurrent: boolean;
}

/**
 * Two or three ways of showing the same page, e.g. the Calendar's Month and
 * By car, side by side with the one showing filled navy (6 Nov 2026 look).
 * Each is a link with its own address, so a view can be shared or
 * bookmarked, and Tab and Enter reach it like any link. At least 44px tall
 * to tap (rule 24).
 */
export function SegmentedLinks({
  links,
  label,
  className,
}: {
  links: readonly SegmentedLink[];
  /** Read out for the set, e.g. "How to show the calendar". */
  label: string;
  className?: string;
}): React.JSX.Element {
  return (
    <nav aria-label={label} className={cn("bg-primary-soft flex gap-1 rounded-xl p-1", className)}>
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          aria-current={link.isCurrent ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring flex min-h-11 flex-1 items-center justify-center rounded-lg px-4 text-sm whitespace-nowrap outline-none focus-visible:ring-2",
            link.isCurrent
              ? "bg-primary text-primary-foreground font-extrabold"
              : "text-primary hover:bg-card font-bold",
          )}
        >
          {link.phoneLabel ? (
            <>
              <span className="md:hidden">{link.phoneLabel}</span>
              <span className="hidden md:inline">{link.label}</span>
            </>
          ) : (
            link.label
          )}
        </a>
      ))}
    </nav>
  );
}
