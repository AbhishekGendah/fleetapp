import { formatDateTimeInTimeZone } from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { FormSection } from "@fleetapp/ui/form-section";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { Undo2 } from "lucide-react";

import type { RemovedFile, RemovedFileKind } from "../../../lib/files/removed-files";
import { restoreCarFileAction } from "./file-actions";

const KEPT_WORDS: Readonly<Record<RemovedFileKind, string>> = {
  photo: "Kept 30 days after it was removed",
  document: "Kept 30 days after it was removed",
  paper: "A receipt or tax paper: kept 5 years after it was removed",
};

/**
 * What was removed from the car and can still come back (review A7-4,
 * G8-7): photos and documents for 30 days, papers on its records for 5 years.
 */
export function RemovedFiles(props: {
  vehicleId: string;
  title: string;
  removed: readonly RemovedFile[];
  timeZone: string;
}) {
  if (props.removed.length === 0) {
    return null;
  }
  return (
    <FormSection title={props.title}>
      <RecordList label={props.title}>
        {props.removed.map((file) => (
          <RecordItem
            key={file.id}
            title={file.label}
            details={
              <p>
                Removed {formatDateTimeInTimeZone(file.removedAt, props.timeZone)}.{" "}
                {KEPT_WORDS[file.kind]}.
              </p>
            }
            actions={
              <ActionButton
                action={restoreCarFileAction.bind(null, props.vehicleId, file.id)}
                label={`Bring back ${file.label}`}
                pendingLabel="Bringing back…"
                icon={<Undo2 aria-hidden />}
              />
            }
          />
        ))}
      </RecordList>
    </FormSection>
  );
}
