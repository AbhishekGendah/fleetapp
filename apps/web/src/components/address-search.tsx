"use client";

import { describeErrorForLog, type AustralianStateCode } from "@fleetapp/core";
import { SuggestionBox } from "@fleetapp/ui/suggestion-box";
import { useEffect, useRef, useState } from "react";

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

/** A lost connection only means no suggestions: the box still works. */
function logLookupFailure(error: unknown): void {
  console.warn("Address lookup did not answer", describeErrorForLog(error));
}

interface SuggestionSearch {
  query: string;
  isEnabled: boolean;
  nearState: AustralianStateCode | null;
  sessionToken: React.RefObject<string>;
}

/** Suggestions for what is typed, fetched after a pause in typing. */
function useAddressSuggestions(search: SuggestionSearch): AddressSuggestion[] {
  const { query, isEnabled, nearState, sessionToken } = search;
  // Kept with the text they were found for, and shown only while the box
  // still holds that text, so an old answer never shows up.
  const [results, setResults] = useState<{ query: string; suggestions: AddressSuggestion[] }>({
    query: "",
    suggestions: [],
  });

  useEffect(() => {
    if (!isEnabled || query.length < ADDRESS_SEARCH_MINIMUM_LENGTH) {
      return;
    }
    const timer = setTimeout(() => {
      searchAddressesAction(query, sessionToken.current, nearState)
        .catch((error: unknown) => {
          logLookupFailure(error);
          return [];
        })
        .then((found) => {
          setResults({ query, suggestions: found });
        });
    }, TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query, isEnabled, nearState, sessionToken]);

  return isEnabled && results.query === query ? results.suggestions : [];
}

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
  ...inputProps
}: AddressSearchProps) {
  const [shouldSearch, setShouldSearch] = useState(false);
  // One token per address being looked up: Google bills the typing and the
  // pick together as one lookup.
  const sessionToken = useRef<string>(crypto.randomUUID());
  const suggestions = useAddressSuggestions({
    query: value.trim(),
    isEnabled: shouldSearch,
    nearState,
    sessionToken,
  });

  async function choose(suggestion: AddressSuggestion): Promise<void> {
    setShouldSearch(false);
    onValueChange(suggestion.mainText);
    const address = await getAddressAction(suggestion.placeId, sessionToken.current).catch(
      (error: unknown) => {
        logLookupFailure(error);
        return null;
      },
    );
    sessionToken.current = crypto.randomUUID();
    if (address) {
      onAddressChosen(address);
    }
  }

  return (
    <SuggestionBox
      {...inputProps}
      value={value}
      onValueChange={(typed) => {
        setShouldSearch(true);
        onValueChange(typed);
      }}
      suggestions={suggestions}
      suggestionKey={(suggestion) => suggestion.placeId}
      renderSuggestion={(suggestion) => (
        <>
          <span className="font-medium">{suggestion.mainText}</span>
          {suggestion.secondaryText ? (
            <span className="text-muted-foreground text-xs">{suggestion.secondaryText}</span>
          ) : null}
        </>
      )}
      onSuggestionChosen={(suggestion) => void choose(suggestion)}
      onDismiss={() => setShouldSearch(false)}
      footer={
        // Google's terms: results shown without a Google map must credit Google.
        <p className="text-muted-foreground border-t px-3 py-1.5 text-right text-xs">
          Powered by Google
        </p>
      }
    />
  );
}
