import { formatDateTimeInTimeZone } from "./format-date-time";
import { acceptanceWording, type AcceptanceFacts } from "./handover";
import { isSameLocalMinute } from "./local-date-time";
import { MILLISECONDS_PER_MINUTE } from "./time-units";

/**
 * A return time a few minutes ahead of the server's clock is still taken
 * as now: the phone's clock and the server's are never quite the same.
 */
const RETURN_CLOCK_ALLOWANCE_MINUTES = 5;

export type ReturnTimeProblem = "before_handover" | "in_future";

/**
 * When the car came back, as the Operator says (now, or the real time of
 * an after-hours drop-off): never before it was handed over, never later
 * than now. Possession ends at this moment (rule 15).
 */
export function returnTimeProblem(
  returnedAt: Date,
  limits: { handedOverAt: Date; now: Date },
): ReturnTimeProblem | null {
  if (returnedAt.getTime() <= limits.handedOverAt.getTime()) {
    return "before_handover";
  }
  const latest = limits.now.getTime() + RETURN_CLOCK_ALLOWANCE_MINUTES * MILLISECONDS_PER_MINUTE;
  return returnedAt.getTime() > latest ? "in_future" : null;
}

/**
 * The return time to record from what was typed, to the minute: a time in
 * the minute of now, or of the handover itself, means now (the box cannot
 * hold seconds, and possession must end after it began). Anything else is
 * the time typed, if it passes `returnTimeProblem`.
 */
export function recordedReturnTime(
  typed: Date,
  limits: { handedOverAt: Date; now: Date; timeZone: string },
): { at: Date } | { problem: ReturnTimeProblem } {
  const isThisMinute =
    isSameLocalMinute(typed, limits.now, limits.timeZone) ||
    isSameLocalMinute(typed, limits.handedOverAt, limits.timeZone);
  const at = isThisMinute && limits.now > limits.handedOverAt ? limits.now : typed;
  const problem = returnTimeProblem(at, limits);
  return problem ? { problem } : { at };
}

export const RETURN_TIME_MESSAGES: Readonly<Record<ReturnTimeProblem, string>> = {
  before_handover: "The return time must be after the car was handed over.",
  in_future: "The return time cannot be in the future.",
};

/** How far the car went during the rental; null until both readings are in. */
export function kilometresDriven(
  handoverKm: number | null,
  returnKm: number | null,
): number | null {
  return handoverKm === null || returnKm === null ? null : returnKm - handoverKm;
}

/** The words the Renter accepts when they sign at the return. Kept with the report as shown. */
export function returnAcceptanceText(facts: AcceptanceFacts): string {
  return acceptanceWording("returned", facts);
}

/** What the report says in place of the Renter's acceptance when they were not there. */
export function renterAbsentText(input: {
  at: Date;
  timeZone: string;
  /** Who was not there: the Renter, or a business's driver. */
  isBusinessDriver?: boolean;
}): string {
  return `The ${input.isBusinessDriver ? "driver" : "Renter"} was not present. The business recorded the car as returned on ${formatDateTimeInTimeZone(input.at, input.timeZone)}, in the condition shown in this report.`;
}
