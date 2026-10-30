import { describe, expect, it } from "vitest";

import { findListedName, matchingKey, suggestNames, type ListedName } from "./name-matching";
import { inCatalogueSpelling, type VehicleCatalogue } from "./vehicle-catalogue";

const names = (...list: string[]): ListedName[] => list.map((name) => ({ name, aliases: [] }));

const BYD = names("Atto 3", "Dolphin", "Seal", "Sealion 6", "Sealion 7");
const TOYOTA: ListedName[] = [
  ...names("Camry", "Corolla", "Corolla Cross", "HiLux", "Yaris"),
  { name: "LandCruiser Prado", aliases: ["Prado"] },
];
const HYUNDAI = names("i20", "i30");

describe("matchingKey", () => {
  it("keeps only letters and digits, ignoring case", () => {
    expect(matchingKey("Sea-Lion 6")).toBe("sealion6");
    expect(matchingKey("  C-HR ")).toBe("chr");
  });
});

describe("findListedName", () => {
  it("treats spacing, capitals, dashes and dots as the same name", () => {
    for (const typed of ["sea lion 6", "SEALION6", "Sea-Lion 6", "sealion 6 "]) {
      expect(findListedName(BYD, typed)).toBe("Sealion 6");
    }
    expect(findListedName(TOYOTA, "hi lux")).toBe("HiLux");
  });

  it("knows a name by its aliases", () => {
    expect(findListedName(TOYOTA, "prado")).toBe("LandCruiser Prado");
  });

  it("never takes a typo as a match", () => {
    expect(findListedName(TOYOTA, "corrola")).toBeNull();
    expect(findListedName(HYUNDAI, "i40")).toBeNull();
  });
});

describe("suggestNames", () => {
  it("offers names starting with what was typed, then names containing it", () => {
    expect(suggestNames(TOYOTA, "cor")).toEqual(["Corolla", "Corolla Cross"]);
    expect(suggestNames(TOYOTA, "cross")).toEqual(["Corolla Cross"]);
  });

  it("matches across spacing and dashes", () => {
    expect(suggestNames(BYD, "sea lion")).toEqual(["Sealion 6", "Sealion 7"]);
  });

  it("offers near misses after real matches", () => {
    expect(suggestNames(TOYOTA, "corrola")).toEqual(["Corolla", "Corolla Cross"]);
    expect(suggestNames(TOYOTA, "hilxu")).toEqual(["HiLux"]);
    expect(suggestNames(BYD, "sealoin 6")).toContain("Sealion 6");
  });

  it("offers a name by its alias", () => {
    expect(suggestNames(TOYOTA, "prad")).toEqual(["LandCruiser Prado"]);
  });

  it("offers the whole list for an empty box, and nothing for nonsense", () => {
    expect(suggestNames(BYD, "")).toHaveLength(BYD.length);
    expect(suggestNames(BYD, "zzzzzz")).toEqual([]);
  });
});

describe("inCatalogueSpelling", () => {
  const catalogue: VehicleCatalogue = [
    { name: "Toyota", aliases: [], models: TOYOTA },
    { name: "Mercedes-Benz", aliases: ["Mercedes", "Merc"], models: names("C-Class") },
  ];

  it("saves listed cars in the list's spelling", () => {
    expect(inCatalogueSpelling(catalogue, { make: "toyota", model: "hi-lux" })).toEqual({
      make: "Toyota",
      model: "HiLux",
    });
    expect(inCatalogueSpelling(catalogue, { make: "merc", model: "c class" })).toEqual({
      make: "Mercedes-Benz",
      model: "C-Class",
    });
  });

  it("keeps a car not in the list exactly as typed", () => {
    expect(inCatalogueSpelling(catalogue, { make: "Trabant", model: "601" })).toEqual({
      make: "Trabant",
      model: "601",
    });
    expect(inCatalogueSpelling(catalogue, { make: "Toyota", model: "Crown" })).toEqual({
      make: "Toyota",
      model: "Crown",
    });
  });
});
