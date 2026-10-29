"use client";

import * as React from "react";

import { filterOptions } from "../lib/filter-options";
import { SuggestionBox, type SuggestionBoxProps } from "./suggestion-box";

type ComboBoxProps = Omit<
  SuggestionBoxProps<string>,
  "suggestions" | "suggestionKey" | "renderSuggestion" | "onSuggestionChosen" | "onDismiss"
> & {
  /** The names to offer. Anything else can still be typed. */
  options: readonly string[];
};

/**
 * A box that suggests names from a list as you type, and still takes any
 * text: for picking a car make, say, where a rare one may not be listed.
 * The list opens when the box is tapped or typed in.
 */
export function ComboBox({ options, value, onValueChange, onFocus, ...boxProps }: ComboBoxProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const matching = filterOptions(options, value);
  // A name typed out in full needs no list under it.
  const isExactMatch =
    matching.length === 1 && matching[0]!.toLowerCase() === value.trim().toLowerCase();

  return (
    <SuggestionBox
      {...boxProps}
      value={value}
      onValueChange={(typed) => {
        setIsOpen(true);
        onValueChange(typed);
      }}
      onFocus={(event) => {
        setIsOpen(true);
        onFocus?.(event);
      }}
      suggestions={isOpen && !isExactMatch ? matching : []}
      suggestionKey={(option) => option}
      renderSuggestion={(option) => option}
      onSuggestionChosen={(option) => {
        setIsOpen(false);
        onValueChange(option);
      }}
      onDismiss={() => setIsOpen(false)}
    />
  );
}
