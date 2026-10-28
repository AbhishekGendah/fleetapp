import type { AustralianStateCode } from "./postcodes";

/**
 * Every timezone in use in Australia, with the name an Operator would
 * recognise, and the state it mostly covers (Sydney's zone also covers the
 * ACT, which sits inside NSW). Melbourne and Sydney keep the same clock but are separate zones
 * in the timezone database, so both are offered.
 */
export const AUSTRALIAN_TIMEZONES = [
  { id: "Australia/Perth", label: "Perth (WA)", state: "WA" },
  { id: "Australia/Eucla", label: "Eucla (WA, border towns)", state: "WA" },
  { id: "Australia/Darwin", label: "Darwin (NT)", state: "NT" },
  { id: "Australia/Adelaide", label: "Adelaide (SA)", state: "SA" },
  { id: "Australia/Broken_Hill", label: "Broken Hill (NSW, on Adelaide time)", state: "NSW" },
  { id: "Australia/Brisbane", label: "Brisbane (QLD)", state: "QLD" },
  { id: "Australia/Sydney", label: "Sydney, Canberra (NSW, ACT)", state: "NSW" },
  { id: "Australia/Melbourne", label: "Melbourne (VIC)", state: "VIC" },
  { id: "Australia/Hobart", label: "Hobart (TAS)", state: "TAS" },
  { id: "Australia/Lord_Howe", label: "Lord Howe Island", state: "NSW" },
] as const satisfies readonly { id: string; label: string; state: AustralianStateCode }[];

export type AustralianTimezone = (typeof AUSTRALIAN_TIMEZONES)[number]["id"];

const TIMEZONE_IDS: ReadonlySet<string> = new Set(AUSTRALIAN_TIMEZONES.map((zone) => zone.id));

export function isAustralianTimezone(value: string): value is AustralianTimezone {
  return TIMEZONE_IDS.has(value);
}

/** The state a timezone mostly covers, e.g. Perth's zone is WA. */
export function stateForTimezone(timezone: string): AustralianStateCode | null {
  return AUSTRALIAN_TIMEZONES.find((zone) => zone.id === timezone)?.state ?? null;
}
