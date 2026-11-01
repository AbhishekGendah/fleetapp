import isoCountries from "i18n-iso-countries";

/**
 * Countries an overseas licence can come from, as ISO 3166 two-letter codes
 * from the standard list (i18n-iso-countries), Australia left out: its
 * licences are issued by a state. The code is stored; the name is shown in
 * Australian English.
 */
const AUSTRALIA = "AU";

/** A two-letter country code known to be on the list. */
export type CountryCode = string & { readonly isCountryCode: true };

export const OVERSEAS_COUNTRY_CODES: readonly CountryCode[] = Object.keys(
  isoCountries.getAlpha2Codes(),
).filter((code): code is CountryCode => code !== AUSTRALIA);

export function isOverseasCountryCode(value: string): value is CountryCode {
  return (OVERSEAS_COUNTRY_CODES as readonly string[]).includes(value);
}

const COUNTRY_NAMES = new Intl.DisplayNames(["en-AU"], { type: "region" });

/** "New Zealand" for "NZ"; the code itself if the name is unknown. */
export function countryName(code: string): string {
  return COUNTRY_NAMES.of(code) ?? code;
}

/** Every country, with its name, in alphabetical order of name, for a dropdown. */
export function overseasCountryOptions(): { value: CountryCode; label: string }[] {
  return OVERSEAS_COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code) })).sort(
    (left, right) => left.label.localeCompare(right.label),
  );
}
