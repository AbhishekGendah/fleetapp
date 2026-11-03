"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import * as React from "react";

import { cn } from "../lib/utils";

export interface ToggleOption<Value extends string> {
  value: Value;
  label: string;
}

export interface ToggleGroupProps<Value extends string> {
  /** Read out for the group, e.g. "Show cars". */
  label: string;
  options: readonly ToggleOption<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
}

/**
 * A row of buttons choosing one of a few values, e.g. All, Available, Out:
 * the chosen one stays pressed. Arrow keys move between them. Built on Base
 * UI's ToggleGroup; each button is at least 44px tall to tap (rule 24).
 */
export function ToggleGroup<Value extends string>({
  label,
  options,
  value,
  onValueChange,
}: ToggleGroupProps<Value>): React.JSX.Element {
  return (
    <BaseToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        // Pressing the chosen one again keeps it: one value is always chosen.
        const [chosen] = next as Value[];
        if (chosen) {
          onValueChange(chosen);
        }
      }}
      className="bg-muted inline-flex flex-wrap gap-1 rounded-md p-1"
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          className={cn(
            "min-h-11 rounded px-3 text-sm font-medium outline-none",
            "focus-visible:ring-ring focus-visible:ring-2",
            "data-[pressed]:bg-background data-[pressed]:text-primary data-[pressed]:shadow-sm",
          )}
        >
          {option.label}
        </Toggle>
      ))}
    </BaseToggleGroup>
  );
}
