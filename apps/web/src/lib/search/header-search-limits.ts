/**
 * The top bar's search (docs/plans/look-and-feel.md, "Slice 2"). A plain
 * file, so the box in the browser and the check on the server share them.
 */

/** One letter would match nearly everything; two is where results become useful. */
export const HEADER_SEARCH_MINIMUM_LENGTH = 2;
/** Longer than any name, rego or phone anyone types into a quick search. */
export const HEADER_SEARCH_MAXIMUM_LENGTH = 60;
/** A few of each kind: the full lists have their own search for more. */
export const HEADER_SEARCH_GROUP_SIZE = 5;
