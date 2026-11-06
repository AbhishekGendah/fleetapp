import { Card, SectionLabel } from "@fleetapp/ui/card";
import Link from "next/link";
import * as React from "react";

/**
 * A white card named by its small capitals label (6 Nov 2026 look), as a
 * region screen readers can jump to: the dashboard's cards, a rental's
 * Next step and Signed papers.
 */
export function SectionCard(props: {
  heading: string;
  /** Beside the label, at the right: a count, or a link such as "All money ›". */
  aside?: React.ReactNode;
  /** A fixed id for the label, where another part of the page points at it. */
  headingId?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const generatedId = React.useId();
  const headingId = props.headingId ?? generatedId;
  return (
    <Card>
      <section aria-labelledby={headingId} className="flex flex-col px-4 pt-4 pb-1 sm:px-5">
        <div className="flex min-h-7 items-center justify-between gap-2 pb-1">
          <SectionLabel id={headingId}>{props.heading}</SectionLabel>
          {props.aside}
        </div>
        {props.children}
      </section>
    </Card>
  );
}

/** A card's link to the whole of what it shows, e.g. "All money ›", for its label's right. */
export function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-teal hover:text-primary inline-flex min-h-11 items-center gap-1 text-sm font-bold hover:underline"
    >
      {children}
      <span aria-hidden>›</span>
    </Link>
  );
}
