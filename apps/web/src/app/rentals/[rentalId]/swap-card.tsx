import { canSwapCar, type DocumentEmailState } from "@fleetapp/core";
import { withTenant } from "@fleetapp/db/tenant-context";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { RecordList } from "@fleetapp/ui/record-list";
import { ArrowLeftRight, ClipboardCheck, XCircle } from "lucide-react";
import Link from "next/link";

import { appDb } from "../../../lib/app-db";
import {
  listChecklistReports,
  loadDocumentEmailStates,
  type ChecklistReport,
} from "../../../lib/contracts/document-emails";
import { loadRentalHandoverStatus } from "../../../lib/handover/handover-queries";
import { CONTRACTS_PATH, rentalSwapPath } from "../../../lib/paths";
import { listRentalSwaps, type SwapSummary } from "../../../lib/rentals/car-swaps";
import { driverChangeUnderWay } from "../../../lib/rentals/driver-change-under-way";
import { listPickableCars } from "../../../lib/rentals/pickable-records";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import { loadDefaultTemplate } from "../../../lib/contracts/templates";
import type { SignedInUser } from "../../../lib/require-user";
import { FinishedPairItem } from "./issued-paper";
import { cancelSwapAction, startSwapAction } from "./swap/swap-actions";
import { LazyStartSwapForm } from "./swap/lazy-start-swap-form";

/** One finished swap: which cars, when, why, and its three papers (review G9-5). */
function SwapItem(props: {
  swap: SwapSummary;
  rentalId: string;
  timeZone: string;
  reports: readonly ChecklistReport[];
  emails: ReadonlyMap<string, DocumentEmailState>;
}) {
  const { swap } = props;
  const reportOf = (inspectionId: string) =>
    props.reports.find((report) => report.inspectionId === inspectionId);
  const papers = [
    swap.documentId
      ? { kind: "swap_form" as const, documentId: swap.documentId, label: "Open swap form" }
      : null,
    ...[
      { report: reportOf(swap.returnInspectionId), label: `Open return report (${swap.fromRego})` },
      {
        report: reportOf(swap.handoverInspectionId),
        label: `Open handover report (${swap.toRego})`,
      },
    ].map(({ report, label }) =>
      report ? { kind: report.kind, documentId: report.documentId, label } : null,
    ),
  ].filter((paper) => paper !== null);
  return (
    <FinishedPairItem
      title={`${swap.fromRego} → ${swap.toRego}`}
      badge="Swapped"
      reason={swap.reason}
      doneWord="Swapped"
      doneAt={swap.swappedAt}
      timeZone={props.timeZone}
      rentalId={props.rentalId}
      papers={papers}
      emails={props.emails}
    />
  );
}

/** Carry on with the swap under way, or stop it. */
function SwapUnderWay({ rentalId, swap }: { rentalId: string; swap: SwapSummary }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Swap under way: {swap.fromRego} → {swap.toRego}.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild className="w-full sm:w-auto">
          <Link href={rentalSwapPath(rentalId, "old")}>
            <ClipboardCheck aria-hidden />
            Continue swap
          </Link>
        </Button>
        <ActionButton
          action={cancelSwapAction.bind(null, rentalId)}
          label="Cancel swap"
          pendingLabel="Cancelling…"
          variant="danger"
          icon={<XCircle aria-hidden />}
          confirm={{
            title: "Cancel this swap?",
            description:
              "The photos and damage marks taken so far on both cars are thrown away, and the Renter keeps the car they have.",
            confirmLabel: "Yes, cancel the swap",
            keepLabel: "No, keep the swap",
          }}
        />
      </div>
    </div>
  );
}

/** Starting a swap: needs the swap form written, and an available car. */
async function SwapStarter({ rental, user }: { rental: RentalDetail; user: SignedInUser }) {
  const [template, cars] = await Promise.all([
    loadDefaultTemplate(appDb, user.operatorId, "swap_form"),
    listPickableCars(appDb, user.operatorId, { isAvailableOnly: true }),
  ]);
  if (!template) {
    return (
      <p className="text-muted-foreground text-sm">
        To swap the car, first write your{" "}
        <Link href={CONTRACTS_PATH} className="text-teal hover:text-primary font-semibold">
          Car swap form in Settings → Contracts
        </Link>
        .
      </p>
    );
  }
  return (
    <FormDialog
      triggerLabel="Swap car"
      triggerIcon={<ArrowLeftRight aria-hidden />}
      title="Swap the Renter's car"
    >
      <LazyStartSwapForm action={startSwapAction.bind(null, rental.id)} cars={cars} />
    </FormDialog>
  );
}

/**
 * Swapping the Renter's car during the rental (rule 15): the old car checked
 * in, the new one checked out, and the Renter signs on this phone. Hidden
 * while the rental's own return, or a driver change, is under way.
 */
export async function SwapCard({ rental, user }: { rental: RentalDetail; user: SignedInUser }) {
  const isSwappable = canSwapCar(rental.status);
  const [swaps, returnStatus, driverChange] = await Promise.all([
    listRentalSwaps(appDb, user.operatorId, rental.id),
    isSwappable
      ? loadRentalHandoverStatus(appDb, user.operatorId, rental.id, "return")
      : Promise.resolve(null),
    withTenant(appDb, user.operatorId, (tx) =>
      driverChangeUnderWay(tx, user.operatorId, rental.id),
    ),
  ]);
  const underWay = swaps.find((swap) => swap.status === "in_progress");
  const finished = swaps.filter((swap) => swap.status === "completed");
  // A return or a driver change has the car's check-in: the swap waits for it.
  const canStart = isSwappable && !returnStatus?.inProgressId && !driverChange;
  if (!canStart && finished.length === 0) {
    return null;
  }
  const reports = await listChecklistReports(appDb, user.operatorId, rental.id);
  const emails = await loadDocumentEmailStates(appDb, user.operatorId, [
    ...reports.filter((report) => report.isForSwap).map((report) => report.documentId),
    ...finished.flatMap((swap) => (swap.documentId ? [swap.documentId] : [])),
  ]);
  return (
    <Card>
      <CardHeader>
        <SectionLabel>Car swap</SectionLabel>
        <CardDescription>
          The car handed back gets a return checklist, the new car a handover checklist, then the
          Renter signs the swap form on your phone. The rest of the rental stays the same.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canStart && underWay ? <SwapUnderWay rentalId={rental.id} swap={underWay} /> : null}
        {canStart && !underWay ? <SwapStarter rental={rental} user={user} /> : null}
        {finished.length > 0 ? (
          <RecordList label="Swaps">
            {finished.map((swap) => (
              <SwapItem
                key={swap.id}
                swap={swap}
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
