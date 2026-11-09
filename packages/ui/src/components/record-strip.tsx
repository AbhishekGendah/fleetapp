import { ChevronLeft } from "lucide-react";
import * as React from "react";

import { PAGE_GUTTER_CLASSES, PAGE_WIDTH_CLASSES } from "../lib/page-width";
import { cn } from "../lib/utils";
import { SECTION_LABEL_CLASSES } from "./card";

/** One key fact on the strip, e.g. Owing $0.00, "All paid up". */
export interface RecordStripFact {
  /** Typed in ordinary case; shown in small capitals. */
  label: string;
  value: React.ReactNode;
  /** A quieter line under the value, e.g. "Fri 13 Nov, direct debit". */
  note?: React.ReactNode;
}

export interface RecordStripProps {
  /** The list one level up, e.g. the Rentals list from a rental. */
  backHref: string;
  /** Where back goes, e.g. "Rentals". Read out as "Back to Rentals". */
  backLabel: string;
  /** The page's heading: what the record is. Can hold links (InlineRecordLink tone="onPrimary"). */
  title: React.ReactNode;
  /** The line under the title, e.g. "Toyota Corolla · weekly, no end date". */
  subtitle?: React.ReactNode;
  /** Status labels (Badge) beside the subtitle. */
  badges?: React.ReactNode;
  facts?: readonly RecordStripFact[];
  /**
   * A flow of a few steps on the phone (e.g. a driver change): each step's
   * name and which one this page is (from 0). Shown as a bar per step and
   * "Step 2 of 3: Check in from Sam" under the title.
   */
  steps?: { names: readonly string[]; current: number };
  /**
   * The record's buttons: Button variant="inverse" for the main one (put it
   * last, so it sits at the right on a computer) and variant="inverse-outline"
   * for the rest. Full width on a phone.
   */
  actions?: React.ReactNode;
}

/** The bars of a few-step flow, then which step this is, in words. */
function StripSteps({ names, current }: { names: readonly string[]; current: number }) {
  return (
    <div className="flex flex-col gap-2 md:col-span-2">
      <div className="flex gap-1.5" aria-hidden>
        {names.map((name, index) => (
          <span
            key={name}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              index <= current ? "bg-on-primary-label" : "bg-primary-foreground/20",
            )}
          />
        ))}
      </div>
      <p className="text-on-primary-label text-sm font-bold">
        Step {current + 1} of {names.length}: {names[current]}
      </p>
    </div>
  );
}

/**
 * The navy strip that opens every single-item page (one rental, one car, one
 * Renter): its name, status and key facts, and its buttons (the navy strip
 * rule, 6 Nov 2026). Lists and the dashboard stay white.
 *
 * It spans the whole content area, edge to edge: pass it to the app frame's
 * `strip` slot rather than inside the page's own content, which has gutters.
 * Its words line up with the content below. White and pale teal on navy are
 * all over 7:1 (WCAG 1.4.3 AAA).
 */
export function RecordStrip(props: RecordStripProps): React.JSX.Element {
  const facts = props.facts ?? [];
  const titleId = React.useId();
  return (
    <section aria-labelledby={titleId} className="bg-primary text-primary-foreground">
      <div
        className={cn(
          "grid gap-3 pt-2 pb-5 md:grid-cols-[minmax(0,1fr)_auto] md:gap-x-4 md:pb-6",
          PAGE_WIDTH_CLASSES,
          PAGE_GUTTER_CLASSES,
        )}
      >
        <a
          href={props.backHref}
          aria-label={`Back to ${props.backLabel}`}
          className="text-on-primary-label hover:text-primary-foreground focus-visible:ring-primary-foreground inline-flex min-h-11 items-center gap-1 justify-self-start rounded-full pr-3 text-sm font-bold outline-none focus-visible:ring-2 md:col-span-2"
        >
          <ChevronLeft className="size-5" aria-hidden />
          {props.backLabel}
        </a>

        <div className="flex min-w-0 flex-col gap-1.5">
          <h1
            id={titleId}
            className="text-2xl leading-tight font-extrabold tracking-tight break-words md:text-3xl"
          >
            {props.title}
          </h1>
          {props.subtitle || props.badges ? (
            <div className="flex flex-wrap items-center gap-2.5">
              {props.subtitle ? (
                <span className="text-on-primary-muted text-sm md:text-base">{props.subtitle}</span>
              ) : null}
              {props.badges}
            </div>
          ) : null}
        </div>

        {props.steps ? <StripSteps {...props.steps} /> : null}

        {facts.length > 0 ? (
          <dl className="grid grid-cols-3 gap-2 md:col-span-2 md:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] md:gap-2.5">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="bg-primary-foreground/10 flex min-w-0 flex-col gap-0.5 rounded-xl p-2.5 md:px-3.5 md:py-3"
              >
                <dt className={cn("text-on-primary-label", SECTION_LABEL_CLASSES)}>{fact.label}</dt>
                <dd className="text-base font-extrabold md:text-xl">{fact.value}</dd>
                {fact.note ? (
                  <dd className="text-on-primary-muted text-xs md:text-sm">{fact.note}</dd>
                ) : null}
              </div>
            ))}
          </dl>
        ) : null}

        {props.actions ? (
          // On a computer: to the right of the title. On a phone: after the facts, full width.
          <div className="flex flex-col gap-2 md:col-start-2 md:row-start-2 md:flex-row md:flex-wrap md:items-start md:justify-end [&>*]:w-full md:[&>*]:w-auto">
            {props.actions}
          </div>
        ) : null}
      </div>
    </section>
  );
}
