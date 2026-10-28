/**
 * Every timezone in use in Australia, with the name an Operator would
 * recognise. Melbourne and Sydney keep the same clock but are separate zones
 * in the timezone database, so both are offered.
 */
export const AUSTRALIAN_TIMEZONES = [
  { id: "Australia/Perth", label: "Perth (WA)" },
  { id: "Australia/Eucla", label: "Eucla (WA, border towns)" },
  { id: "Australia/Darwin", label: "Darwin (NT)" },
  { id: "Australia/Adelaide", label: "Adelaide (SA)" },
  { id: "Australia/Broken_Hill", label: "Broken Hill (NSW, on Adelaide time)" },
  { id: "Australia/Brisbane", label: "Brisbane (QLD)" },
  { id: "Australia/Sydney", label: "Sydney, Canberra (NSW, ACT)" },
  { id: "Australia/Melbourne", label: "Melbourne (VIC)" },
  { id: "Australia/Hobart", label: "Hobart (TAS)" },
  { id: "Australia/Lord_Howe", label: "Lord Howe Island" },
] as const;

export type AustralianTimezone = (typeof AUSTRALIAN_TIMEZONES)[number]["id"];

const TIMEZONE_IDS: ReadonlySet<string> = new Set(AUSTRALIAN_TIMEZONES.map((zone) => zone.id));

export function isAustralianTimezone(value: string): value is AustralianTimezone {
  return TIMEZONE_IDS.has(value);
}
