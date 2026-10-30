"use client";

import * as React from "react";

import { findListedName, suggestNames, type ListedName } from "@fleetapp/core";
import { SuggestionBox, type SuggestionBoxProps } from "./suggestion-box";

type ComboBoxProps = Omit<
  SuggestionBoxProps<string>,
  "suggestions" | "suggestionKey" | "renderSuggestion" | "onSuggestionChosen" | "onDismiss"
> & {
  /** The names to offer, with what else people call them. Anything else can still be typed. */
  options: readonly ListedName[];
};

/**
 * A box that suggests names from a list as you type, and still takes any
 * text: for picking a car make, say, where a rare one may not be listed.
 * Suggestions ignore spacing and capitals, include near misses and know
 * aliases ("Prado"), with the same rules the server saves by.
 * The list opens when the box is tapped or typed in.
 */
export function ComboBox({ options, value, onValueChange, onFocus, ...boxProps }: ComboBoxProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const matching = suggestNames(options, value);
  // A name typed out exactly as listed needs no list under it. "sea lion 6"
  // still shows "Sealion 6", so the person sees how it will be saved.
  const isExactMatch = findListedName(options, value) === value.trim();

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
