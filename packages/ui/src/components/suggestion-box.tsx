"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import * as React from "react";

import { cn } from "../lib/utils";
import { Input } from "./input";

export type SuggestionBoxProps<Suggestion> = Omit<
  React.ComponentPropsWithoutRef<"input">,
  "value" | "onChange" | "role"
> & {
  value: string;
  onValueChange: (value: string) => void;
  /** What to offer for the text in the box. Empty closes the list. */
  suggestions: readonly Suggestion[];
  suggestionKey: (suggestion: Suggestion) => string;
  renderSuggestion: (suggestion: Suggestion) => React.ReactNode;
  onSuggestionChosen: (suggestion: Suggestion) => void;
  /** Escape was pressed or the box was left: the owner should stop suggesting. */
  onDismiss: () => void;
  /** Shown under the suggestions, e.g. a credit to whoever supplied them. */
  footer?: React.ReactNode;
};

/** Base UI's reason when a suggestion is picked rather than typed. */
const ITEM_PRESS = "item-press";

/**
 * A text box with a list of suggestions under it, on Base UI's Autocomplete:
 * arrow keys move through them, Enter or a tap picks one, Escape closes the
 * list, and Tab moves on keeping what was typed. Typing always stays free;
 * what to suggest is up to whoever uses it (a fixed list, a lookup).
 */
export function SuggestionBox<Suggestion>({
  value,
  onValueChange,
  suggestions,
  suggestionKey,
  renderSuggestion,
  onSuggestionChosen,
  onDismiss,
  footer,
  className,
  ...inputProps
}: SuggestionBoxProps<Suggestion>) {
  const byKey = new Map(suggestions.map((suggestion) => [suggestionKey(suggestion), suggestion]));

  return (
    <Autocomplete.Root
      items={suggestions}
      // Whoever uses the box has already chosen what to suggest.
      filter={null}
      itemToStringValue={suggestionKey}
      value={value}
      onValueChange={(next, details) => {
        if (details.reason !== ITEM_PRESS) {
          onValueChange(next);
          return;
        }
        // A pick hands over the suggestion itself; its owner decides what the box then shows.
        const chosen = byKey.get(next);
        if (chosen !== undefined) {
          onSuggestionChosen(chosen);
        }
      }}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onDismiss();
        }
      }}
    >
      <div className={cn("relative", className)}>
        <Autocomplete.Input render={<Input {...inputProps} autoComplete="off" />} />
      </div>
      <Autocomplete.Portal>
        <Autocomplete.Positioner sideOffset={4} className="z-50 w-(--anchor-width)">
          <Autocomplete.Popup className="bg-card overflow-hidden rounded-md border shadow-lg">
            <Autocomplete.List className="max-h-64 overflow-y-auto">
              {(suggestion: Suggestion) => (
                <Autocomplete.Item
                  key={suggestionKey(suggestion)}
                  value={suggestion}
                  className="data-highlighted:bg-primary-soft flex min-h-11 cursor-pointer flex-col justify-center px-3 py-2 text-sm"
                >
                  {renderSuggestion(suggestion)}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
            {footer}
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
