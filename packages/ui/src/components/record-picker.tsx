"use client";

import { Combobox } from "@base-ui/react/combobox";
import { ChevronDown } from "lucide-react";
import * as React from "react";

import { Input } from "./input";
import { RECORD_ITEM_PROPS, RecordPickerList, type PickableRecord } from "./record-picker-parts";

export type { PickableRecord } from "./record-picker-parts";

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
      {...RECORD_ITEM_PROPS}
      name={name}
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
      <RecordPickerList emptyMessage={emptyMessage} />
    </Combobox.Root>
  );
}
