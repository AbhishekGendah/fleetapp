import { AUSTRALIAN_STATE_CODES } from "@fleetapp/core";
import { z } from "zod";

/** Fewer letters than this match half of Australia: not worth a lookup. */
export const ADDRESS_SEARCH_MINIMUM_LENGTH = 3;
const ADDRESS_SEARCH_MAXIMUM_LENGTH = 200;

/**
 * What the browser may send. A place ID goes into Google's URL, so it is held
 * to the characters Google uses.
 */
export const addressSearchInputSchema = z.object({
  query: z.string().trim().min(ADDRESS_SEARCH_MINIMUM_LENGTH).max(ADDRESS_SEARCH_MAXIMUM_LENGTH),
  sessionToken: z.uuid(),
  nearState: z.enum(AUSTRALIAN_STATE_CODES).nullable(),
});

export const addressChoiceInputSchema = z.object({
  placeId: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/),
  sessionToken: z.uuid(),
});
