import { countryName, OVERSEAS_ISSUER } from "@fleetapp/core";

/** "WA", or "Overseas: New Zealand"; empty when not given. */
export function licenceIssuedInText(issuedIn: string | null, country: string | null): string {
  return issuedIn === OVERSEAS_ISSUER && country
    ? `Overseas: ${countryName(country)}`
    : (issuedIn ?? "");
}
