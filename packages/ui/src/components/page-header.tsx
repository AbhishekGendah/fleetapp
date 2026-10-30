import { ArrowLeft } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

interface PageHeaderProps {
  /** The page one level up, e.g. the Cars list from a car. */
  backHref: string;
  /** Where back goes, e.g. "Cars". Read out as "Back to Cars". */
  backLabel: string;
  title: React.ReactNode;
  /** Beside the title, e.g. a status badge. */
  aside?: React.ReactNode;
  className?: string;
}

/**
 * The top of every page below a main section: a back arrow to the page one
 * level up, and the page's title. On a phone it stays at the top while the
 * page scrolls, so the way back is always in reach. Back goes up a level
 * rather than to the last page seen, so it still works when the page was
 * opened from a link or a bookmark.
 */
export function PageHeader(props: PageHeaderProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "bg-background/95 sticky top-0 z-20 -mx-4 -mt-4 flex min-h-14 items-center gap-2 border-b px-2 py-1 backdrop-blur md:static md:m-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none",
        props.className,
      )}
    >
      <a
        href={props.backHref}
        aria-label={`Back to ${props.backLabel}`}
        className="text-teal hover:bg-muted focus-visible:ring-ring inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full pr-3 pl-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
      >
        <ArrowLeft className="size-5" aria-hidden />
        <span className="hidden sm:inline">{props.backLabel}</span>
      </a>
      <h1 className="text-primary min-w-0 truncate text-xl font-extrabold md:text-2xl">
        {props.title}
      </h1>
      {props.aside ? <div className="shrink-0">{props.aside}</div> : null}
    </div>
  );
}
