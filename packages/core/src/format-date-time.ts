import { AUSTRALIAN_LOCALE } from "./locale";

/**
 * A moment as the Operator would read it on their own clock (rule 10), e.g.
 * "27 Oct 2026, 2:15 pm AWST". The zone's short name is included because the
 * reader may not be where the Operator is.
 */
export function formatDateTimeInTimeZone(moment: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(AUSTRALIAN_LOCALE, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(moment);
}
