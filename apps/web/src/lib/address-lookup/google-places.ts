import { STATE_AREAS, type AustralianStateCode } from "@fleetapp/core";
import { z } from "zod";

import { addressFromComponents, type AddressParts } from "./address-from-components";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const PLACE_URL = "https://places.googleapis.com/v1/places/";
/** A lookup that takes longer than this is given up on: the box still works without it. */
const REQUEST_TIMEOUT_MS = 3000;
const AUSTRALIA_REGION_CODE = "au";
/** Only the address parts: Google charges more for fields like opening hours. */
const PLACE_FIELD_MASK = "addressComponents";

export interface AddressSuggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

const autocompleteResponseSchema = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z
          .object({
            placeId: z.string(),
            text: z.object({ text: z.string() }),
            structuredFormat: z
              .object({
                mainText: z.object({ text: z.string() }),
                secondaryText: z.object({ text: z.string() }).optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

const placeResponseSchema = z.object({
  addressComponents: z
    .array(
      z.object({
        longText: z.string().default(""),
        shortText: z.string().default(""),
        types: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

export class AddressLookupError extends Error {
  override name = "AddressLookupError";
}

export interface GooglePlacesClient {
  /** Suggestions in `nearState` come first; others still appear. */
  suggestAddresses(
    input: string,
    sessionToken: string,
    nearState: AustralianStateCode | null,
  ): Promise<AddressSuggestion[]>;
  getAddress(placeId: string, sessionToken: string): Promise<AddressParts>;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    // Only the status: Google's error text can quote what was typed.
    throw new AddressLookupError(`Google Places answered ${response.status}`);
  }
  return response.json();
}

/**
 * Talks to Google Places (New) from the server, so the key never reaches the
 * browser and Google never sees the person's IP address. Both calls share a
 * session token: Google then bills the suggestions and the chosen address as
 * one lookup.
 */
export function createGooglePlacesClient(
  apiKey: string,
  fetchImplementation: typeof fetch = fetch,
): GooglePlacesClient {
  return {
    async suggestAddresses(input, sessionToken, nearState) {
      // A bias, not a restriction: an interstate address is still found.
      const locationBias = nearState
        ? {
            rectangle: {
              low: STATE_AREAS[nearState].southWest,
              high: STATE_AREAS[nearState].northEast,
            },
          }
        : undefined;
      const response = await fetchImplementation(AUTOCOMPLETE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
        body: JSON.stringify({
          input,
          sessionToken,
          includedRegionCodes: [AUSTRALIA_REGION_CODE],
          regionCode: AUSTRALIA_REGION_CODE,
          locationBias,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const { suggestions } = autocompleteResponseSchema.parse(await readJson(response));
      return suggestions.flatMap(({ placePrediction }) =>
        placePrediction
          ? [
              {
                placeId: placePrediction.placeId,
                mainText:
                  placePrediction.structuredFormat?.mainText.text ?? placePrediction.text.text,
                secondaryText: placePrediction.structuredFormat?.secondaryText?.text ?? "",
              },
            ]
          : [],
      );
    },

    async getAddress(placeId, sessionToken) {
      const url = `${PLACE_URL}${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
      const response = await fetchImplementation(url, {
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": PLACE_FIELD_MASK },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const { addressComponents } = placeResponseSchema.parse(await readJson(response));
      return addressFromComponents(addressComponents);
    },
  };
}
