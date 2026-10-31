import { describeErrorForLog, type AustralianStateCode } from "@fleetapp/core";

import type { AddressParts } from "./address-from-components";
import { AddressLookupError, type AddressSuggestion } from "./google-places";
import { addressChoiceInputSchema, addressSearchInputSchema } from "./lookup-input";
import { placesClient } from "./places-client";

/** Never the error or the query itself: either can hold an address. */
function logLookupFailure(step: string, error: unknown): void {
  console.error(`Address lookup failed at ${step}`, {
    ...describeErrorForLog(error),
    // Ours, and only ever "Google Places answered <status>".
    message: error instanceof AddressLookupError ? error.message : undefined,
  });
}

/**
 * Suggestions for a partly typed address, checked first. An empty list on any
 * failure: the box carries on as a plain text box. Callers decide who may
 * spend the Google quota.
 */
export async function suggestAddresses(
  query: string,
  sessionToken: string,
  nearState: AustralianStateCode | null,
): Promise<AddressSuggestion[]> {
  const parsed = addressSearchInputSchema.safeParse({ query, sessionToken, nearState });
  if (!parsed.success) {
    return [];
  }
  try {
    return await placesClient.suggestAddresses(
      parsed.data.query,
      parsed.data.sessionToken,
      parsed.data.nearState,
    );
  } catch (error) {
    logLookupFailure("suggestions", error);
    return [];
  }
}

/** The full address for a chosen suggestion, or null if it cannot be had. */
export async function fetchAddress(
  placeId: string,
  sessionToken: string,
): Promise<AddressParts | null> {
  const parsed = addressChoiceInputSchema.safeParse({ placeId, sessionToken });
  if (!parsed.success) {
    return null;
  }
  try {
    return await placesClient.getAddress(parsed.data.placeId, parsed.data.sessionToken);
  } catch (error) {
    logLookupFailure("address", error);
    return null;
  }
}
