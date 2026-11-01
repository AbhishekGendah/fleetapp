import type * as React from "react";

/** One labelled line of a record's details: "Car", "1ABC234 · Toyota Corolla". */
export type DetailLine = readonly [label: string, value: React.ReactNode];

/** A record's details as label and value: side by side on a wider screen, stacked on a phone. */
export function DetailLines({ lines }: { lines: readonly DetailLine[] }): React.JSX.Element {
  return (
    <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
      {lines.map(([label, value]) => (
        <div key={label} className="flex flex-col sm:contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
