"use client";

import * as React from "react";

import { cn } from "../lib/utils";

export interface TabLink {
  href: string;
  label: string;
  isCurrent: boolean;
  /** Above the label on a phone, before it on a computer. */
  icon?: React.ReactNode;
}

/**
 * Tabs that are links, so each tab has its own address that can be bookmarked
 * or shared. Switching tab replaces the page in the back history rather than
 * adding to it, so the phone's back button leaves the page (e.g. back to the
 * Cars list) instead of stepping back through every tab tapped. On a phone they are a
 * grid of tiles with icons, so every tab is in view and plainly something to
 * tap; on a computer, a row of pill buttons. The current one is filled in.
 */
export function TabLinks({ tabs, label }: { tabs: readonly TabLink[]; label: string }) {
  return (
    <nav aria-label={label} className="grid grid-cols-4 gap-2 md:flex md:flex-wrap md:gap-2">
      {tabs.map((tab) => (
        <a
          key={tab.href}
          href={tab.href}
          aria-current={tab.isCurrent ? "page" : undefined}
          onClick={(event) => {
            // A new tab or window (Ctrl or middle click) is left to the browser.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
              return;
            }
            event.preventDefault();
            window.location.replace(tab.href);
          }}
          className={cn(
            "focus-visible:ring-ring flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-center text-xs leading-tight font-semibold shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none md:min-h-11 md:flex-row md:gap-2 md:rounded-full md:px-4 md:text-sm [&_svg]:size-5 [&_svg]:shrink-0 md:[&_svg]:size-4",
            tab.isCurrent
              ? "border-teal bg-teal text-white"
              : "bg-card text-foreground hover:bg-muted border-border",
          )}
        >
          {tab.icon}
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
