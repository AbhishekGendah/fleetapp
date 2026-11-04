import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailLayout, SmallPrint } from "./email-layout";

/** One part of the nightly run that did not finish cleanly. Counts only, never Renter details (rule 7). */
export interface NightlyRunProblem {
  part: string;
  failedBusinesses: number;
  unreachedBusinesses: number;
  /** Set when the whole part stopped with an error. */
  didStop: boolean;
}

export interface NightlyRunAlertEmailProps {
  /** When the run started, already worded on AGS's clock. */
  ranAt: string;
  problems: readonly NightlyRunProblem[];
}

function problemText(problem: NightlyRunProblem): string {
  if (problem.didStop) {
    return `${problem.part}: stopped with an error before finishing.`;
  }
  const parts = [
    problem.failedBusinesses > 0 ? `${problem.failedBusinesses} businesses failed` : null,
    problem.unreachedBusinesses > 0
      ? `${problem.unreachedBusinesses} businesses not reached before the time limit`
      : null,
  ].filter(Boolean);
  return `${problem.part}: ${parts.join(", ")}.`;
}

export function NightlyRunAlertEmail(props: NightlyRunAlertEmailProps): ReactElement {
  return (
    <EmailLayout preview="The nightly run had a problem" heading="The nightly run had a problem">
      <Text>The run that started {props.ranAt} did not finish cleanly:</Text>
      {props.problems.map((problem) => (
        <Text key={problem.part}>{problemText(problem)}</Text>
      ))}
      <SmallPrint>
        Nothing is charged or issued twice: the next run picks up what this one missed. The server
        logs have the details (business IDs only).
      </SmallPrint>
    </EmailLayout>
  );
}
