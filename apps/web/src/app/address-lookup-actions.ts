"use server";

import type { AddressParts } from "../lib/address-lookup/address-from-components";
import type { AddressSuggestion } from "../lib/address-lookup/google-places";
import {
  addressChoiceInputSchema,
  addressSearchInputSchema,
} from "../lib/address-lookup/lookup-input";
import { placesClient } from "../lib/address-lookup/places-client";
import { requireUser } from "../lib/require-user";

/** Never the error or the query itself: either can hold an address. */
function logLookupFailure(step: string, error: unknown): void {
  console.error(`Address lookup failed at ${step}`, {
    errorType: error instanceof Error ? error.name : typeof error,
    message:
      error instanceof Error && error.name === "AddressLookupError" ? error.message : undefined,
  });
}

/**
 * Suggestions for a partly typed address. Signed-in Users only, so nobody else
 * can spend the Google quota. An empty list on any failure: the box carries on
 * as a plain text box.
 */
export async function searchAddressesAction(
  query: string,
  sessionToken: string,
): Promise<AddressSuggestion[]> {
  await requireUser();
  const parsed = addressSearchInputSchema.safeParse({ query, sessionToken });
  if (!parsed.success) {
    return [];
  }
  try {
    return await placesClient.suggestAddresses(parsed.data.query, parsed.data.sessionToken);
  } catch (error) {
    logLookupFailure("suggestions", error);
    return [];
  }
}

/** The full address for a chosen suggestion, or null if it cannot be had. */
export async function getAddressAction(
  placeId: string,
  sessionToken: string,
): Promise<AddressParts | null> {
  await requireUser();
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
