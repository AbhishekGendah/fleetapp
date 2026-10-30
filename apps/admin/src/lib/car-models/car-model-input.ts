import { requiredLine, singleLineText } from "@fleetapp/core";
import { z } from "zod";

/** More than anyone needs; keeps a pasted paragraph out. */
const MAXIMUM_NICKNAMES = 20;
const MAXIMUM_MODELS_AT_ONCE = 100;

function distinct(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

/** "Merc, Benz": other names people type, separated by commas. */
const nicknames = z
  .string()
  .transform((typed) =>
    distinct(
      typed
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  )
  .pipe(
    z.array(singleLineText).max(MAXIMUM_NICKNAMES, `At most ${MAXIMUM_NICKNAMES} other names.`),
  );

/** A make or a model as named on its admin page. */
export const catalogueEntryInputSchema = z.object({ name: requiredLine, aliases: nicknames });
export type CatalogueEntryInput = z.infer<typeof catalogueEntryInputSchema>;
export const CATALOGUE_ENTRY_FIELDS = ["name", "aliases"] as const;
export type CatalogueEntryField = (typeof CATALOGUE_ENTRY_FIELDS)[number];

/** Several models typed one per line, e.g. a new make's whole range. */
export const addModelsInputSchema = z.object({
  names: z
    .string()
    .transform((typed) =>
      distinct(
        typed
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    )
    .pipe(
      z
        .array(singleLineText)
        .min(1, "Type at least one model.")
        .max(MAXIMUM_MODELS_AT_ONCE, `At most ${MAXIMUM_MODELS_AT_ONCE} at a time.`),
    ),
});
export const ADD_MODELS_FIELDS = ["names"] as const;

/** The make and model chosen for a car typed by an Operator. */
export const carNameInputSchema = z.object({ make: requiredLine, model: requiredLine });
export const CAR_NAME_FIELDS = ["make", "model"] as const;
export type CarNameField = (typeof CAR_NAME_FIELDS)[number];

/** Which button sent the Typed by Operators form: just fix the car, or add to the list too. */
export const FIX_INTENT_FIELD = "intent";
export const ADD_AND_FIX_INTENT = "add_and_fix";

/** Nicknames back into their box, as typed. */
export function nicknamesForEditing(aliases: readonly string[]): string {
  return aliases.join(", ");
}
