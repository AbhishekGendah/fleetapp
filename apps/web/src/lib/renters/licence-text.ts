import { countryName, OVERSEAS_ISSUER } from "@fleetapp/core";

/** "WA", or "Overseas: New Zealand"; empty when not given. */
export function licenceIssuedInText(issuedIn: string | null, country: string | null): string {
  return issuedIn === OVERSEAS_ISSUER && country
    ? `Overseas: ${countryName(country)}`
    : (issuedIn ?? "");
}

/** "1 month", "12 months". Plain text, so server and phone code can both use it. */
export function monthsText(months: number): string {
  return `${months} ${months === 1 ? "month" : "months"}`;
}
