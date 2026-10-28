"use client";

import type { AustralianStateCode } from "@fleetapp/core";
import { Input } from "@fleetapp/ui/input";
import { useEffect, useId, useRef, useState } from "react";

import { getAddressAction, searchAddressesAction } from "../app/address-lookup-actions";
import type { AddressParts } from "../lib/address-lookup/address-from-components";
import type { AddressSuggestion } from "../lib/address-lookup/google-places";
import { ADDRESS_SEARCH_MINIMUM_LENGTH } from "../lib/address-lookup/lookup-input";

/** Wait for a pause in typing, so each word costs one lookup, not one per key. */
const TYPING_PAUSE_MS = 300;

type AddressSearchProps = Omit<React.ComponentPropsWithoutRef<"input">, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  onAddressChosen: (address: AddressParts) => void;
  /** Addresses in this state are suggested first. */
  nearState: AustralianStateCode | null;
};

/**
 * A street address box that suggests real addresses as you type. Typing stays
 * free: a suggestion only fills the form when picked, and if Google is slow,
 * down or over its daily cap, the box is just a box.
 */
export function AddressSearch({
  value,
  onValueChange,
  onAddressChosen,
  nearState,
  onBlur,
  ...inputProps
}: AddressSearchProps) {
  const listId = useId();
  // Suggestions are kept with the text they were found for, and shown only
  // while the box still holds that text, so an old answer never shows up.
  const [results, setResults] = useState<{ query: string; suggestions: AddressSuggestion[] }>({
    query: "",
    suggestions: [],
  });
  const [activeIndex, setActiveIndex] = useState(-1);
  const [shouldSearch, setShouldSearch] = useState(false);
  // One token per address being looked up: Google bills the typing and the
  // pick together as one lookup.
  const sessionToken = useRef<string>(crypto.randomUUID());

  const query = value.trim();
  const suggestions = shouldSearch && results.query === query ? results.suggestions : [];

  useEffect(() => {
    if (!shouldSearch || query.length < ADDRESS_SEARCH_MINIMUM_LENGTH) {
      return;
    }
    const timer = setTimeout(() => {
      void searchAddressesAction(query, sessionToken.current, nearState).then((found) => {
        setResults({ query, suggestions: found });
        setActiveIndex(-1);
      });
    }, TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query, shouldSearch, nearState]);

  function close(): void {
    setActiveIndex(-1);
    setShouldSearch(false);
  }

  async function choose(suggestion: AddressSuggestion): Promise<void> {
    close();
    onValueChange(suggestion.mainText);
    const address = await getAddressAction(suggestion.placeId, sessionToken.current);
    sessionToken.current = crypto.randomUUID();
    if (address) {
      onAddressChosen(address);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (suggestions.length === 0) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + step + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      // Enter picks the highlighted address instead of saving the form.
      event.preventDefault();
      void choose(suggestions[activeIndex]!);
    } else if (event.key === "Escape") {
      close();
    }
  }

  const isOpen = suggestions.length > 0;

  return (
    <div className="relative">
      <Input
        {...inputProps}
        value={value}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        onChange={(event) => {
          setShouldSearch(true);
          onValueChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          close();
          onBlur?.(event);
        }}
      />
      {isOpen ? (
        <div className="bg-card absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border shadow-lg">
          <ul id={listId} role="listbox">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.placeId}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                // Before the box's blur, which would close the list first.
                onMouseDown={(event) => {
                  event.preventDefault();
                  void choose(suggestion);
                }}
                className={`flex min-h-11 cursor-pointer flex-col justify-center px-3 py-2 text-sm ${
                  index === activeIndex ? "bg-primary-soft" : ""
                }`}
              >
                <span className="font-medium">{suggestion.mainText}</span>
                {suggestion.secondaryText ? (
                  <span className="text-muted-foreground text-xs">{suggestion.secondaryText}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {/* Google's terms: results shown without a Google map must credit Google. */}
          <p className="text-muted-foreground border-t px-3 py-1.5 text-right text-xs">
            Powered by Google
          </p>
        </div>
      ) : null}
    </div>
  );
}
