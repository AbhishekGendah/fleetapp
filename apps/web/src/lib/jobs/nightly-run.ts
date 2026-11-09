import "server-only";

import { describeErrorForLog, formatDateTimeInTimeZone } from "@fleetapp/core";
import { renderNightlyRunAlertEmail, type NightlyRunProblem } from "@fleetapp/email";

import { env } from "../../env";
import { appEmailSender } from "../email-sender";
import type { OperatorRun } from "./due-operators";

/** AGS's own clock, for the alert email only. */
const AGS_TIME_ZONE = "Australia/Perth";

export type PartResult = { run: OperatorRun } | { error: true };
export interface PartOutcome {
  part: string;
  result: PartResult;
}

/** Runs one part of a nightly run; a part that throws is logged and reported, never stops the next. */
export async function runPart(
  part: string,
  work: () => Promise<OperatorRun>,
): Promise<PartOutcome> {
  try {
    return { part, result: { run: await work() } };
  } catch (error) {
    console.error(`The nightly run's ${part} part stopped`, describeErrorForLog(error));
    return { part, result: { error: true } };
  }
}

function problemOf(outcome: PartOutcome): NightlyRunProblem | null {
  if ("error" in outcome.result) {
    return { part: outcome.part, failedBusinesses: 0, unreachedBusinesses: 0, didStop: true };
  }
  const { failedOperators, unreachedOperators } = outcome.result.run;
  return failedOperators > 0 || unreachedOperators > 0
    ? {
        part: outcome.part,
        failedBusinesses: failedOperators,
        unreachedBusinesses: unreachedOperators,
        didStop: false,
      }
    : null;
}

/** Tells AGS the run did not finish cleanly (review G3-4). A failed alert is logged, never thrown. */
async function sendAlert(startedAt: Date, problems: readonly NightlyRunProblem[]): Promise<void> {
  try {
    await appEmailSender.send(
      await renderNightlyRunAlertEmail({
        to: env.OPS_ALERT_EMAIL,
        ranAt: formatDateTimeInTimeZone(startedAt, AGS_TIME_ZONE),
        problems,
      }),
    );
  } catch (error) {
    console.error("Sending the nightly run alert failed", describeErrorForLog(error));
  }
}

/** Emails AGS about any part that did not finish cleanly; whether there was one. */
export async function reportProblems(
  startedAt: Date,
  outcomes: readonly PartOutcome[],
): Promise<boolean> {
  const problems = outcomes.flatMap((outcome) => problemOf(outcome) ?? []);
  if (problems.length > 0) {
    await sendAlert(startedAt, problems);
  }
  return problems.length > 0;
}
