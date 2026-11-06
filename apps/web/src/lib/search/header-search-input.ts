import { z } from "zod";

import { HEADER_SEARCH_MAXIMUM_LENGTH, HEADER_SEARCH_MINIMUM_LENGTH } from "./header-search-limits";

/** What the top bar's search accepts: trimmed, at least two characters, and not too long. */
export const headerSearchTextSchema = z
  .string()
  .trim()
  .min(HEADER_SEARCH_MINIMUM_LENGTH)
  .max(HEADER_SEARCH_MAXIMUM_LENGTH);
