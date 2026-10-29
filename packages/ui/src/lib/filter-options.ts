/** Enough to choose from on a phone screen without scrolling far. */
const MAXIMUM_SHOWN = 50;

/** Names that start with the text first, then names that contain it, ignoring case. */
export function filterOptions(options: readonly string[], typed: string): string[] {
  const search = typed.trim().toLowerCase();
  if (!search) {
    return options.slice(0, MAXIMUM_SHOWN);
  }
  const lower = (option: string) => option.toLowerCase();
  const starting = options.filter((option) => lower(option).startsWith(search));
  const containing = options.filter(
    (option) => !lower(option).startsWith(search) && lower(option).includes(search),
  );
  return [...starting, ...containing].slice(0, MAXIMUM_SHOWN);
}
