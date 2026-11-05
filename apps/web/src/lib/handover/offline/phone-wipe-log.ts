/** What the browser's log says when wiping a checklist from the phone fails: never its details. */
export const WIPE_FAILED_LOG = "Wiping a checklist from this phone failed";

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}
