import { findListedName, type ListedName } from "./name-matching";

/**
 * The shared list of car makes and models that every Operator's car form
 * suggests from. AGS keeps it on the admin site; it is loaded from the
 * database, so a change there reaches every Operator at once.
 */
export interface CatalogueMake extends ListedName {
  models: readonly ListedName[];
}

export type VehicleCatalogue = readonly CatalogueMake[];

/** The listed make that what was typed means, or null if it is not listed. */
export function findCatalogueMake(catalogue: VehicleCatalogue, typed: string): CatalogueMake | null {
  const name = findListedName(catalogue, typed);
  return catalogue.find((make) => make.name === name) ?? null;
}

/** The models listed for a make, however it was typed. Empty for a make not listed. */
export function catalogueModels(catalogue: VehicleCatalogue, make: string): readonly ListedName[] {
  return findCatalogueMake(catalogue, make)?.models ?? [];
}

/**
 * A car's make and model in the list's own spelling when they are listed
 * ("hilux" → "HiLux", "Prado" → "LandCruiser Prado"), as typed otherwise.
 */
export function inCatalogueSpelling(
  catalogue: VehicleCatalogue,
  car: { make: string; model: string },
): { make: string; model: string } {
  const make = findCatalogueMake(catalogue, car.make);
  return {
    make: make?.name ?? car.make,
    model: (make && findListedName(make.models, car.model)) ?? car.model,
  };
}
