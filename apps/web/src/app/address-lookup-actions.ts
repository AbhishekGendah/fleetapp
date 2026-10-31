"use server";

import type { AustralianStateCode } from "@fleetapp/core";

import type { AddressParts } from "../lib/address-lookup/address-from-components";
import type { AddressSuggestion } from "../lib/address-lookup/google-places";
import { fetchAddress, suggestAddresses } from "../lib/address-lookup/lookup";
import { requireUser } from "../lib/require-user";

/** Suggestions for a partly typed address. Signed-in Users only, so nobody else can spend the Google quota. */
export async function searchAddressesAction(
  query: string,
  sessionToken: string,
  nearState: AustralianStateCode | null,
): Promise<AddressSuggestion[]> {
  await requireUser();
  return suggestAddresses(query, sessionToken, nearState);
}

/** The full address for a chosen suggestion, or null if it cannot be had. */
export async function getAddressAction(
  placeId: string,
  sessionToken: string,
): Promise<AddressParts | null> {
  await requireUser();
  return fetchAddress(placeId, sessionToken);
}
