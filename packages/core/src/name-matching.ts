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
/** Short names are easy to mistype into another real one, so they get less slack. */
const LONG_NAME_LENGTH = 6;
const SHORT_NAME_TYPOS = 1;
const LONG_NAME_TYPOS = 2;

/** The part of a name that matters for matching: letters and digits, ignoring case. */
export function matchingKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
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
 * Edits (a letter added, removed, changed or two swapped) between two keys,
 * stopping early once past `limit`.
 */
function editDistance(left: string, right: string, limit: number): number {
  if (Math.abs(left.length - right.length) > limit) {
    return limit + 1;
  }
  let previousRow = Array.from({ length: right.length + 1 }, (_, index) => index);
  let rowBeforeThat: number[] = [];
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const row = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const isSame = left[leftIndex - 1] === right[rightIndex - 1];
      let best = Math.min(
        previousRow[rightIndex]! + 1,
        row[rightIndex - 1]! + 1,
        previousRow[rightIndex - 1]! + (isSame ? 0 : 1),
      );
      const isSwap =
        leftIndex > 1 &&
        rightIndex > 1 &&
        left[leftIndex - 1] === right[rightIndex - 2] &&
        left[leftIndex - 2] === right[rightIndex - 1];
      if (isSwap) {
        best = Math.min(best, rowBeforeThat[rightIndex - 2]! + 1);
      }
      row.push(best);
    }
    rowBeforeThat = previousRow;
    previousRow = row;
  }
  return previousRow[right.length]!;
}

function isTypoOf(typedKey: string, key: string): boolean {
  const limit = key.length >= LONG_NAME_LENGTH ? LONG_NAME_TYPOS : SHORT_NAME_TYPOS;
  // Compare with the start of a longer name too, so "corrol" finds "Corolla Cross".
  const candidates = [key, key.slice(0, typedKey.length)];
  return candidates.some((candidate) => editDistance(typedKey, candidate, limit) <= limit);
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
  const ranked = entries
    .map((entry) => {
      const keys = keysOf(entry);
      const rank = keys.some((key) => key.startsWith(typedKey))
        ? 0
        : keys.some((key) => key.includes(typedKey))
          ? 1
          : keys.some((key) => isTypoOf(typedKey, key))
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
