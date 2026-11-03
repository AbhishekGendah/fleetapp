"use client";

import { Combobox } from "@base-ui/react/combobox";
import * as React from "react";

import { cn } from "../lib/utils";

/** One record to pick, e.g. a Renter or a car. */
export interface PickableRecord {
  /** The record's id: what the form sends. */
  value: string;
  /** What the box shows once picked, e.g. "Sam Example" or "1ABC234". */
  label: string;
  /** A second line to tell similar ones apart, e.g. "Toyota Camry, available". Searched too. */
  description?: string;
}

/** Every word typed appears somewhere in the record's name or second line, whatever the capitals. */
export function matchesSearch(record: PickableRecord, query: string): boolean {
  const searched = `${record.label} ${record.description ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => searched.includes(word));
}

/** How the pickers read a record: by its name, matched by its id. */
export const RECORD_ITEM_PROPS = {
  itemToStringLabel: (record: PickableRecord) => record.label,
  itemToStringValue: (record: PickableRecord) => record.value,
  isItemEqualToValue: (record: PickableRecord, other: PickableRecord) =>
    record.value === other.value,
  filter: matchesSearch,
  openOnInputClick: true,
  autoHighlight: true,
} as const;

/** The list that opens under a picker: each record with its second line, or a message when none match. */
export function RecordPickerList({ emptyMessage }: { emptyMessage: string }): React.JSX.Element {
  return (
    <Combobox.Portal>
      <Combobox.Positioner className="z-50 outline-none" sideOffset={4}>
        <Combobox.Popup className="bg-card w-[var(--anchor-width)] max-w-[var(--available-width)] rounded-md border shadow-lg">
          <Combobox.Empty className="text-muted-foreground px-3 py-3 text-sm empty:hidden">
            {emptyMessage}
          </Combobox.Empty>
          <Combobox.List className="max-h-[min(20rem,var(--available-height))] overflow-y-auto py-1 data-[empty]:p-0">
            {(record: PickableRecord) => (
              <Combobox.Item
                key={record.value}
                value={record}
                className={cn(
                  "flex min-h-11 cursor-default flex-col justify-center px-3 py-2 text-base outline-none select-none",
                  "data-[highlighted]:bg-muted data-[selected]:font-medium",
                )}
              >
                <span>{record.label}</span>
                {record.description ? (
                  <span className="text-muted-foreground text-sm">{record.description}</span>
                ) : null}
              </Combobox.Item>
            )}
          </Combobox.List>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  );
}
