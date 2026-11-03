"use client";

import { Combobox } from "@base-ui/react/combobox";
import { X } from "lucide-react";
import * as React from "react";

import { RECORD_ITEM_PROPS, RecordPickerList, type PickableRecord } from "./record-picker-parts";

const ESCAPE_KEY_REASON = "escape-key";

export interface MultiRecordPickerProps {
  id: string;
  records: readonly PickableRecord[];
  /** The chosen records' ids, in the order chosen. */
  values: readonly string[];
  onValuesChange: (values: string[]) => void;
  placeholder?: string;
  /** Shown when nothing matches what was typed. */
  emptyMessage: string;
}

/**
 * Picks several records from a list by typing part of each, e.g. the cars
 * to show: the chosen ones sit in the box as chips, each with a remove
 * button. Backspace in an empty box removes the last; Escape just closes
 * the list. Built on Base UI's
 * Combobox, like the one-record picker, so it reads and searches the same.
 */
export function MultiRecordPicker({
  id,
  records,
  values,
  onValuesChange,
  placeholder,
  emptyMessage,
}: MultiRecordPickerProps): React.JSX.Element {
  const chosen = records.filter((record) => values.includes(record.value));
  return (
    <Combobox.Root
      items={records}
      multiple
      value={chosen}
      onValueChange={(next: PickableRecord[], details) => {
        // Escape only closes the list: Base UI would otherwise empty every choice.
        if (details.reason !== ESCAPE_KEY_REASON) {
          onValuesChange(next.map((record) => record.value));
        }
      }}
      {...RECORD_ITEM_PROPS}
    >
      <Combobox.Chips className="border-input bg-background focus-within:ring-ring flex min-h-11 flex-wrap items-center gap-1 rounded-md border px-2 py-1 focus-within:ring-2">
        <Combobox.Value>
          {(picked: PickableRecord[]) =>
            picked.map((record) => (
              <Combobox.Chip
                key={record.value}
                className="bg-muted flex items-center gap-1 rounded px-2 py-1 text-sm"
              >
                {record.label}
                <Combobox.ChipRemove
                  aria-label={`Remove ${record.label}`}
                  className="hover:bg-background flex h-6 w-6 items-center justify-center rounded"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </Combobox.ChipRemove>
              </Combobox.Chip>
            ))
          }
        </Combobox.Value>
        <Combobox.Input
          id={id}
          placeholder={chosen.length === 0 ? placeholder : undefined}
          className="min-h-9 min-w-24 flex-1 bg-transparent text-base outline-none"
        />
      </Combobox.Chips>
      <RecordPickerList emptyMessage={emptyMessage} />
    </Combobox.Root>
  );
}
