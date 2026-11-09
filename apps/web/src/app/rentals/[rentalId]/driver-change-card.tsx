import { canChangeDriver, type DocumentEmailState } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";
import { RecordList } from "@fleetapp/ui/record-list";
import { ClipboardCheck } from "lucide-react";
import Link from "next/link";

import { appDb } from "../../../lib/app-db";
import {
  listChecklistReports,
  loadDocumentEmailStates,
  type ChecklistReport,
} from "../../../lib/contracts/document-emails";
import { rentalDriverChangePath } from "../../../lib/paths";
import {
  listRentalDriverChanges,
  type DriverChangeSummary,
} from "../../../lib/rentals/driver-changes";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { SignedInUser } from "../../../lib/require-user";
import { CancelDriverChangeButton } from "./driver-change/cancel-driver-change-button";
import { FinishedPairItem } from "./issued-paper";

/** One finished driver change: who to whom, when, why, and its two reports. */
function DriverChangeItem(props: {
  change: DriverChangeSummary;
  rentalId: string;
  timeZone: string;
  reports: readonly ChecklistReport[];
  emails: ReadonlyMap<string, DocumentEmailState>;
}) {
  const { change } = props;
  const papers = [
    { inspectionId: change.returnInspectionId, label: `Open check-in report (${change.fromName})` },
    { inspectionId: change.handoverInspectionId, label: `Open handover report (${change.toName})` },
  ].flatMap(({ inspectionId, label }) => {
    const report = props.reports.find((paper) => paper.inspectionId === inspectionId);
    return report ? [{ ...report, label }] : [];
  });
  return (
    <FinishedPairItem
      title={`${change.fromName} → ${change.toName}`}
      badge="Changed"
      reason={change.reason}
      doneWord="Changed"
      doneAt={change.changedAt}
      timeZone={props.timeZone}
      rentalId={props.rentalId}
      papers={papers}
      emails={props.emails}
    />
  );
}

/**
 * Changing a business's driver while its car is out (decision 4): the car
 * checked in from the driver who has it, then the new driver signs for it
 * on this phone. Shown on a business's rental once its car is out, with the
 * change under way and the ones finished.
 */
export async function DriverChangeCard(props: { rental: RentalDetail; user: SignedInUser }) {
  const { rental, user } = props;
  if (rental.renterKind !== "organisation" || !rental.handedOverAt) {
    return null;
  }
  const changes = await listRentalDriverChanges(appDb, user.operatorId, rental.id);
  const underWay = changes.find((change) => change.status === "in_progress");
  const finished = changes.filter((change) => change.status === "completed");
  // Started from the strip or the Rental card's Change driver; shown here once there is one.
  const canStart = canChangeDriver(rental.status, rental.renterKind);
  if (!(canStart && underWay) && finished.length === 0) {
    return null;
  }
  const reports = await listChecklistReports(appDb, user.operatorId, rental.id);
  const emails = await loadDocumentEmailStates(
    appDb,
    user.operatorId,
    reports.filter((report) => report.isForDriverChange).map((report) => report.documentId),
  );
  return (
    <Card>
      <CardHeader>
        <SectionLabel>Driver change</SectionLabel>
        <CardDescription>
          The car is checked in from the driver who has it, then the new driver signs for it on your
          phone. The rent, bond and contract stay the same.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canStart && underWay ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Driver change under way: {underWay.fromName} → {underWay.toName}.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild className="w-full sm:w-auto">
                <Link href={rentalDriverChangePath(rental.id, "check-in")}>
                  <ClipboardCheck aria-hidden />
                  Continue driver change
                </Link>
              </Button>
              <CancelDriverChangeButton rentalId={rental.id} />
            </div>
          </div>
        ) : null}
        {finished.length > 0 ? (
          <RecordList label="Driver changes">
            {finished.map((change) => (
              <DriverChangeItem
                key={change.id}
                change={change}
                rentalId={rental.id}
                timeZone={user.operatorTimezone}
                reports={reports}
                emails={emails}
              />
            ))}
          </RecordList>
        ) : null}
      </CardContent>
    </Card>
  );
}
