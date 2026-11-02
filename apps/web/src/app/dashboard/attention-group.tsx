import { Badge, type BadgeTone } from "@fleetapp/ui/badge";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import Link from "next/link";
import type * as React from "react";

export interface AttentionItem {
  key: string;
  href: string;
  title: string;
  details?: React.ReactNode;
  badges?: readonly { label: string; tone: BadgeTone }[];
}

/**
 * One group on the dashboard, e.g. "Overdue returns 2": its count in the
 * heading, the first few records, and a link to the rest. Shows nothing
 * when the group is empty, so the dashboard lists only what needs doing.
 */
export function AttentionGroup(props: {
  heading: string;
  total: number;
  items: readonly AttentionItem[];
  seeAll?: { href: string; label: string };
}) {
  if (props.total === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-2" aria-label={props.heading}>
      <h3 className="flex items-baseline justify-between gap-2 font-semibold">
        {props.heading}
        <span className="text-muted-foreground text-sm tabular-nums">{props.total}</span>
      </h3>
      <RecordList label={props.heading}>
        {props.items.map((item) => (
          <RecordItem
            key={item.key}
            title={
              <Link href={item.href} className="text-teal underline">
                {item.title}
              </Link>
            }
            details={
              <>
                {item.details}
                {item.badges && item.badges.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {item.badges.map((badge) => (
                      <Badge key={badge.label} tone={badge.tone}>
                        {badge.label}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </>
            }
          />
        ))}
      </RecordList>
      {props.seeAll && props.total > props.items.length ? (
        <Link
          href={props.seeAll.href}
          className="text-teal inline-flex min-h-11 items-center text-sm font-semibold hover:underline"
        >
          {props.seeAll.label} →
        </Link>
      ) : null}
    </section>
  );
}
