import { isAustralianStateCode, type AustralianStateCode } from "@fleetapp/core";

/** One part of an address as Google returns it, e.g. the suburb. */
export interface AddressComponent {
  longText: string;
  shortText: string;
  types: readonly string[];
}

/** What a chosen address fills in on a form. Blank where Google had nothing. */
export interface AddressParts {
  addressLine1: string;
  suburb: string;
  state: AustralianStateCode | "";
  postcode: string;
}

/**
 * Turns Google's address parts into an Australian street address, written the
 * way Australia Post expects: a unit goes before the street number with a
 * slash, "3/12 Hay Street".
 */
export function addressFromComponents(components: readonly AddressComponent[]): AddressParts {
  const find = (type: string): AddressComponent | undefined =>
    components.find((component) => component.types.includes(type));

  const unit = find("subpremise")?.shortText;
  const streetNumber = find("street_number")?.shortText;
  const street = find("route")?.longText ?? "";
  const number = unit && streetNumber ? `${unit}/${streetNumber}` : (streetNumber ?? "");
  const state = find("administrative_area_level_1")?.shortText ?? "";

  return {
    addressLine1: [number, street].filter(Boolean).join(" "),
    suburb: (find("locality") ?? find("sublocality") ?? find("postal_town"))?.longText ?? "",
    state: isAustralianStateCode(state) ? state : "",
    postcode: find("postal_code")?.shortText ?? "",
  };
}
