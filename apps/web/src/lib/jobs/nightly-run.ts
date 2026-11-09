import "server-only";

import { describeErrorForLog, formatDateTimeInTimeZone } from "@fleetapp/core";
import { renderNightlyRunAlertEmail, type NightlyRunProblem } from "@fleetapp/email";
import { NextResponse } from "next/server";

import { env } from "../../env";
import { isScheduledJobRequest } from "../cron-auth";
import { appEmailSender } from "../email-sender";
import type { OperatorRun } from "./due-operators";

const UNAUTHORISED_STATUS = 401;
const FAILED_STATUS = 500;
/**
 * A run stops starting new businesses after this, leaving a minute of its
 * 300 seconds to finish the one under way and send the alert before Vercel
 * cuts it off (review G3-7). The next night carries on: nothing is done
 * twice (rule 20).
 */
const RUN_BUDGET_MS = 240_000;

/** The answer to a call that is not Vercel's scheduler with the job secret; null for one that is. */
export function refusedRun(authorization: string | null): NextResponse | null {
  return isScheduledJobRequest(authorization, env.CRON_SECRET)
    ? null
    : NextResponse.json({ error: "unauthorised" }, { status: UNAUTHORISED_STATUS });
}

/** When a run started, and whether its time budget is spent. */
export function runClock(): { now: Date; isOutOfTime: () => boolean } {
  const now = new Date();
  return { now, isOutOfTime: () => Date.now() - now.getTime() > RUN_BUDGET_MS };
}

/** What a run says back: 500 when anything did not finish, so it shows as failed. */
export function runAnswer(body: Record<string, unknown>, hasProblems: boolean): NextResponse {
  return NextResponse.json(body, { status: hasProblems ? FAILED_STATUS : undefined });
}

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
