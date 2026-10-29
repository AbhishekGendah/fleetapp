import { z } from "zod";

const recordIdSchema = z.uuid();

/**
 * Whether a value from a page address or form could be a record's id. Checked
 * before it reaches a query, so a mangled link reads as "not found" rather
 * than as a database error.
 */
export function isRecordId(value: string): boolean {
  return recordIdSchema.safeParse(value).success;
}
