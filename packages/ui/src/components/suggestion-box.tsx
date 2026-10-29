"use client";

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

/**
 * A text box with a list of suggestions under it: arrow keys move through
 * them, Enter or a tap picks one, Escape closes the list. Typing always stays
 * free; what to suggest is up to whoever uses it (a fixed list, a lookup).
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
  onKeyDown,
  onBlur,
  className,
  ...inputProps
}: SuggestionBoxProps<Suggestion>) {
  const listId = React.useId();
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const isOpen = suggestions.length > 0;

  function choose(suggestion: Suggestion): void {
    setActiveIndex(-1);
    onSuggestionChosen(suggestion);
  }

  function dismiss(): void {
    setActiveIndex(-1);
    onDismiss();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    onKeyDown?.(event);
    if (!isOpen) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + step + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" && activeIndex >= 0 && activeIndex < suggestions.length) {
      // Enter picks the highlighted suggestion instead of submitting the form.
      event.preventDefault();
      choose(suggestions[activeIndex]!);
    } else if (event.key === "Escape") {
      dismiss();
    }
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        {...inputProps}
        value={value}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={isOpen && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        onChange={(event) => {
          // New text, new suggestions: nothing is highlighted yet.
          setActiveIndex(-1);
          onValueChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          dismiss();
          onBlur?.(event);
        }}
      />
      {isOpen ? (
        <div className="bg-card absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border shadow-lg">
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestionKey(suggestion)}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                // Before the box's blur, which would close the list first.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(suggestion);
                }}
                className={cn(
                  "flex min-h-11 cursor-pointer flex-col justify-center px-3 py-2 text-sm",
                  index === activeIndex && "bg-primary-soft",
                )}
              >
                {renderSuggestion(suggestion)}
              </li>
            ))}
          </ul>
          {footer}
        </div>
      ) : null}
    </div>
  );
}
