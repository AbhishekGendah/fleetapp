import { cn } from "../lib/utils";

export interface TabLink {
  href: string;
  label: string;
  isCurrent: boolean;
}

/**
 * Tabs that are links, so each tab has its own address: it can be bookmarked,
 * shared, and opened with the browser's back button. Scrolls sideways on a
 * narrow phone rather than wrapping.
 */
export function TabLinks({ tabs, label }: { tabs: readonly TabLink[]; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => (
        <a
          key={tab.href}
          href={tab.href}
          aria-current={tab.isCurrent ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium",
            tab.isCurrent
              ? "border-teal text-teal"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
