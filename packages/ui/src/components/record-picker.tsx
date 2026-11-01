"use client";

import { Combobox } from "@base-ui/react/combobox";
import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";
import { Input } from "./input";

/** One record to pick, e.g. a Renter or a car. */
export interface PickableRecord {
  /** The record's id: what the form sends. */
  value: string;
  /** What the box shows once picked, e.g. "Sam Example" or "1ABC234". */
  label: string;
  /** A second line to tell similar ones apart, e.g. "Toyota Camry, available". Searched too. */
  description?: string;
}

export interface RecordPickerProps {
  id: string;
  /** Sent with the form: the picked record's id, or nothing. */
  name: string;
  records: readonly PickableRecord[];
  /** The picked record's id, or "" for none. */
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: (event: React.FocusEvent<HTMLElement>) => void;
  ref?: React.Ref<HTMLInputElement>;
  placeholder?: string;
  /** Shown when nothing matches what was typed. */
  emptyMessage: string;
  "aria-required"?: boolean | "true" | "false";
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
}

/** Every word typed appears somewhere in the record's name or second line, whatever the capitals. */
function matchesSearch(record: PickableRecord, query: string): boolean {
  const searched = `${record.label} ${record.description ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => searched.includes(word));
}

/**
 * Picks one record from a list by typing part of it, on Base UI's
 * Combobox: tap or type to open, arrow keys and Enter (or a tap) to pick,
 * Escape to close. Only a listed record can be picked; the form sends its id.
 */
export function RecordPicker({
  id,
  name,
  records,
  value,
  onValueChange,
  onBlur,
  ref,
  placeholder,
  emptyMessage,
  ...aria
}: RecordPickerProps): React.JSX.Element {
  const picked = records.find((record) => record.value === value) ?? null;

  return (
    <Combobox.Root
      items={records}
      value={picked}
      onValueChange={(next: PickableRecord | null) => onValueChange(next?.value ?? "")}
      itemToStringLabel={(record: PickableRecord) => record.label}
      itemToStringValue={(record: PickableRecord) => record.value}
      isItemEqualToValue={(record: PickableRecord, other: PickableRecord) =>
        record.value === other.value
      }
      filter={matchesSearch}
      name={name}
      openOnInputClick
      autoHighlight
    >
      <Combobox.InputGroup className="relative">
        <Combobox.Input
          id={id}
          ref={ref}
          onBlur={onBlur}
          placeholder={placeholder}
          render={<Input className="pr-11" />}
          {...aria}
        />
        <Combobox.Trigger
          aria-label="Show the list"
          className="text-muted-foreground absolute top-0 right-0 flex h-11 w-11 items-center justify-center"
        >
          <ChevronDown aria-hidden="true" className="h-5 w-5" />
        </Combobox.Trigger>
      </Combobox.InputGroup>
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
    </Combobox.Root>
  );
}
