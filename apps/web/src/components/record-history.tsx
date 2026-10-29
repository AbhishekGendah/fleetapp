import { formatDateTimeInTimeZone } from "@fleetapp/core";
import { describeActivity } from "@fleetapp/db/activity";

import type { HistoryEntry } from "../lib/record-history";

interface RecordHistoryProps {
  entries: readonly HistoryEntry[];
  timezone: string;
  fieldLabel: (field: string) => string;
  describeValue: (field: string, value: unknown) => string;
}

function whoDidIt(entry: HistoryEntry): string {
  if (entry.actorName) {
    return entry.actorName;
  }
  return entry.actorType === "renter_link"
    ? "the Renter"
    : entry.actorType === "admin"
      ? "AGS"
      : "the system";
}

/** "Model: Camry → Corolla", one line per field that changed. */
function ChangedFields(props: RecordHistoryProps & { entry: HistoryEntry }) {
  const before = props.entry.valuesBefore;
  const after = props.entry.valuesAfter;
  if (!before || !after) {
    return null;
  }
  return (
    <ul className="text-muted-foreground mt-1 text-xs">
      {Object.keys(after).map((field) => (
        <li key={field}>
          {props.fieldLabel(field)}: {props.describeValue(field, before[field])} →{" "}
          {props.describeValue(field, after[field])}
        </li>
      ))}
    </ul>
  );
}

/** A record's history tab: who did what and when, newest first (rule 19). */
export function RecordHistory(props: RecordHistoryProps) {
  if (props.entries.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>;
  }
  return (
    <ol className="flex flex-col divide-y">
      {props.entries.map((entry) => (
        <li key={entry.id} className="py-3 text-sm">
          <p>
            <span className="font-medium">{describeActivity(entry.entityType, entry.action)}</span>{" "}
            by {whoDidIt(entry)}
          </p>
          <p className="text-muted-foreground text-xs">
            {formatDateTimeInTimeZone(entry.occurredAt, props.timezone)}
          </p>
          <ChangedFields {...props} entry={entry} />
        </li>
      ))}
    </ol>
  );
}
