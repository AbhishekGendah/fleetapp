import type { AustralianStateCode } from "@fleetapp/core";

import type { AddressSuggestion } from "./google-places";

/** Whether a suggestion's second line ("Safety Bay WA") names the state. */
function isInState(suggestion: AddressSuggestion, state: AustralianStateCode): boolean {
  return new RegExp(`(^|[\\s,])${state}([\\s,]|$)`).test(suggestion.secondaryText);
}

/**
 * Puts suggestions in a state first, keeping Google's order within each
 * group. Google treats a preferred area as a hint, weighed below how well the
 * words match, so on its own it still mixes states together.
 */
export function suggestionsInStateFirst(
  suggestions: readonly AddressSuggestion[],
  state: AustralianStateCode | null,
): AddressSuggestion[] {
  if (!state) {
    return [...suggestions];
  }
  return [
    ...suggestions.filter((suggestion) => isInState(suggestion, state)),
    ...suggestions.filter((suggestion) => !isInState(suggestion, state)),
  ];
}
