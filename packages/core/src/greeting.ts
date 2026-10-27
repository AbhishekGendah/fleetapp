const AFTERNOON_STARTS_AT_HOUR = 12;
const EVENING_STARTS_AT_HOUR = 17;

export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

/** The hour (0 to 23) on the Operator's own clock, not the server's (rule 10). */
function hourInTimeZone(moment: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  }).format(moment);
  return Number(hour);
}

export function getGreeting(moment: Date, timeZone: string): Greeting {
  const hour = hourInTimeZone(moment, timeZone);
  if (hour < AFTERNOON_STARTS_AT_HOUR) {
    return "Good morning";
  }
  return hour < EVENING_STARTS_AT_HOUR ? "Good afternoon" : "Good evening";
}
