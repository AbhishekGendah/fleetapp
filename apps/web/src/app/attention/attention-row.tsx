import { Badge, type BadgeTone } from "@fleetapp/ui/badge";
import { InlineRecordLink, RowLink } from "@fleetapp/ui/row-link";
import Link from "next/link";
import { Fragment } from "react";

import type {
  AttentionItem,
  AttentionUrgency,
  LinePart,
} from "../../lib/dashboard/attention-items";

/** Red, amber and blue labels, which also differ in lightness (rule 34). */
const URGENCY_TONES: Readonly<Record<AttentionUrgency, BadgeTone>> = {
  red: "danger",
  amber: "attention",
  blue: "booked",
};

const LINE_SEPARATOR = " · ";

export function AttentionBadge({ item }: { item: AttentionItem }) {
  return <Badge tone={URGENCY_TONES[item.urgency]}>{item.label}</Badge>;
}

function Part({ part }: { part: LinePart }) {
  return typeof part === "string" ? (
    <>{part}</>
  ) : (
    <InlineRecordLink asChild>
      <Link href={part.href}>{part.text}</Link>
    </InlineRecordLink>
  );
}

/**
 * Who or what on top, as a link to their record; beneath it what's wrong,
 * the row's own link to the place to fix it, then any more names or regos.
 * The row it sits in must carry ROW_CLASSES.
 */
export function AttentionText({ item }: { item: AttentionItem }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
      <InlineRecordLink asChild>
        <Link href={item.who.href}>{item.who.text}</Link>
      </InlineRecordLink>
      <span className="text-muted-foreground text-sm">
        {/* Named with the who too, so the link makes sense on its own (and keeps its words, WCAG 2.5.3). */}
        <RowLink asChild>
          <Link href={item.fix.href} aria-label={`${item.fix.text}, ${item.who.text}`}>
            {item.fix.text}
          </Link>
        </RowLink>
        {item.more.map((part) => (
          <Fragment key={typeof part === "string" ? part : part.href}>
            {LINE_SEPARATOR}
            <Part part={part} />
          </Fragment>
        ))}
      </span>
    </span>
  );
}
