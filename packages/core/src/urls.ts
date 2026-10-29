/** Joins a path onto a base address, whether or not the base ends in a slash. */
export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}
