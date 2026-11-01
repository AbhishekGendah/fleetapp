import Fuse from "fuse.js";

/**
 * Matching what someone typed against a list of names, as a person would:
 * "sea lion 6", "SEALION6" and "Sea-Lion 6" are all "Sealion 6". Used for car
 * makes and models; pure, so the phone suggests with exactly the rules the
 * server saves with.
 */

/** A name in the list, and other names people call it ("Prado" for "LandCruiser Prado"). */
export interface ListedName {
  name: string;
  aliases: readonly string[];
}

/** Enough to choose from on a phone screen without scrolling far. */
const MAXIMUM_SUGGESTIONS = 50;

/** The part of a name that matters for matching: letters and digits, ignoring case and accents. */
export function matchingKey(text: string): string {
  // "Škoda" splits into "S" plus a separate accent mark, which is then dropped.
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function keysOf(entry: ListedName): string[] {
  return [entry.name, ...entry.aliases].map(matchingKey).filter(Boolean);
}

/**
 * The listed name that what was typed means: the same letters and digits as
 * the name or one of its aliases. Null if it is not in the list. A typo is
 * never a match here: it is only ever suggested, since some real names are a
 * character apart (i20, i30).
 */
export function findListedName(entries: readonly ListedName[], typed: string): string | null {
  const key = matchingKey(typed);
  if (!key) {
    return null;
  }
  return entries.find((entry) => keysOf(entry).includes(key))?.name ?? null;
}

/**
 * How close a near miss must be, from 0 (exact) to 1 (anything): Fuse.js's
 * scale. Loose enough for "corrola" and "hilxu", tight enough that nonsense
 * finds nothing.
 */
const NEAR_MISS_THRESHOLD = 0.4;
/** How many characters into a name a near miss may start (Fuse.js's `distance`). */
const NEAR_MISS_DISTANCE = 4;

/** Near misses ("corrola" for "Corolla") by Fuse.js, the standard fuzzy search, best first. */
function nearMisses(entries: readonly ListedName[], typedKey: string): Set<string> {
  const searchable = entries.map((entry) => ({ name: entry.name, keys: keysOf(entry) }));
  const fuse = new Fuse(searchable, {
    keys: ["keys"],
    threshold: NEAR_MISS_THRESHOLD,
    // Typos count near the start of a name only, as people type names from
    // the start: "cross" is not a near miss of "LandCruiser".
    distance: NEAR_MISS_DISTANCE,
  });
  return new Set(fuse.search(typedKey).map((result) => result.item.name));
}

/**
 * What to offer for what was typed, best first: names starting with it, then
 * names containing it, then near misses ("corrola" for "Corolla"). An empty
 * box offers the whole list.
 */
export function suggestNames(entries: readonly ListedName[], typed: string): string[] {
  const typedKey = matchingKey(typed);
  if (!typedKey) {
    return entries.slice(0, MAXIMUM_SUGGESTIONS).map((entry) => entry.name);
  }
  const typos = nearMisses(entries, typedKey);
  const ranked = entries
    .map((entry) => {
      const keys = keysOf(entry);
      const rank = keys.some((key) => key.startsWith(typedKey))
        ? 0
        : keys.some((key) => key.includes(typedKey))
          ? 1
          : typos.has(entry.name)
            ? 2
            : null;
      return { name: entry.name, rank };
    })
    .filter((entry): entry is { name: string; rank: number } => entry.rank !== null);
  // Array sort is stable, so names keep the list's order within each rank.
  return ranked
    .sort((left, right) => left.rank - right.rank)
    .slice(0, MAXIMUM_SUGGESTIONS)
    .map((entry) => entry.name);
}
