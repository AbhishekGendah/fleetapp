import { Card, CardContent, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { appDb } from "../lib/app-db";
import { loadRecordHistory, type HistorySubject } from "../lib/record-history";
import type { SignedInUser } from "../lib/require-user";
import { RecordHistory } from "./record-history";

/** A record's Log card: its history, with its fields named and valued in words. */
export async function HistoryCard(props: {
  user: SignedInUser;
  subjects: readonly HistorySubject[];
  fieldLabel: (field: string) => string;
  /** A stored value in words; gets the Operator's timezone for moments. */
  describeValue: (field: string, value: unknown, timeZone: string) => string;
}) {
  const entries = await loadRecordHistory(appDb, props.user.operatorId, props.subjects);
  const timeZone = props.user.operatorTimezone;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Log</CardTitle>
      </CardHeader>
      <CardContent>
        <RecordHistory
          entries={entries}
          timezone={timeZone}
          fieldLabel={props.fieldLabel}
          describeValue={(field, value) => props.describeValue(field, value, timeZone)}
        />
      </CardContent>
    </Card>
  );
}
