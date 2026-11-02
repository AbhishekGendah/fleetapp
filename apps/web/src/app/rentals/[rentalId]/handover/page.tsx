import { isRecordId } from "@fleetapp/core";
import { PageHeader } from "@fleetapp/ui/page-header";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "../../../app-shell";
import { appDb } from "../../../../lib/app-db";
import { loadSigningStatus } from "../../../../lib/contracts/signing-links";
import {
  HANDOVER_DETAIL_FIELDS,
  type HandoverDetailField,
} from "../../../../lib/handover/handover-input";
import {
  loadHandover,
  loadRentalHandoverStatus,
  type HandoverView,
} from "../../../../lib/handover/handover-queries";
import { carFilePath, rentalPath } from "../../../../lib/paths";
import { loadRentalProblems } from "../../../../lib/rentals/booking-checks";
import { bookingProblemMessage } from "../../../../lib/rentals/rental-messages";
import { requireUser, type SignedInUser } from "../../../../lib/require-user";
import type { ChecklistData, SavedPhoto } from "./checklist-data";
import { HandoverChecklist } from "./handover-checklist";
import { OfflineReady } from "./offline-ready";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNSIGNED_MESSAGE =
  "The Renter has not signed the contract yet: send it from the rental's page.";

function savedPhoto(
  vehicleId: string,
  photo: { fileId: string; thumbnailFileId: string | null },
): SavedPhoto {
  return {
    fileId: photo.fileId,
    viewUrl: carFilePath(vehicleId, photo.thumbnailFileId ?? photo.fileId),
  };
}

function detailValues(view: HandoverView): Record<HandoverDetailField, string> {
  const values: Record<HandoverDetailField, string | number | null> = {
    odometerKm: view.odometerKm,
    fuelLevel: view.fuelLevel,
    keysCount: view.keysCount,
    accessories: view.accessories,
    notes: view.notes,
  };
  return Object.fromEntries(
    HANDOVER_DETAIL_FIELDS.map((field) => [
      field,
      values[field] === null ? "" : String(values[field]),
    ]),
  ) as Record<HandoverDetailField, string>;
}

/** What stops the acceptance beyond the checklist itself, and any bond still to come. */
async function acceptanceChecks(user: SignedInUser, view: HandoverView) {
  const clock = { timeZone: user.operatorTimezone, now: new Date() };
  const [signing, problems] = await Promise.all([
    loadSigningStatus(appDb, user.operatorId, view.rentalId, clock.now),
    loadRentalProblems(appDb, user.operatorId, { ...view, id: view.rentalId }, clock),
  ]);
  const found = typeof problems === "string" ? [] : problems;
  const blockers = found
    .filter((problem) => problem.level === "handover" && problem.code !== "bond_short")
    .map(bookingProblemMessage);
  const bondShort = found.find((problem) => problem.code === "bond_short");
  return {
    blockers: signing.signed ? blockers : [UNSIGNED_MESSAGE, ...blockers],
    bondShortCents: bondShort?.code === "bond_short" ? bondShort.owingCents : null,
  };
}

function checklistData(
  view: HandoverView,
  checks: Pick<ChecklistData, "blockers" | "bondShortCents">,
): ChecklistData {
  return {
    rentalId: view.rentalId,
    inspectionId: view.inspectionId,
    carLabel: `${view.carRego} · ${view.carMakeModel}`,
    renterName: view.renterFullName,
    photoNames: view.photoNames,
    photos: Object.fromEntries(
      [...view.photos].map(([name, photo]) => [name, savedPhoto(view.vehicleId, photo)]),
    ),
    marks: view.damageMarks.map((mark) => ({
      id: mark.id,
      x: mark.x,
      y: mark.y,
      description: mark.description,
      photo: mark.photo ? savedPhoto(view.vehicleId, mark.photo) : null,
    })),
    details: detailValues(view),
    gaps: view.gaps,
    ...checks,
  };
}

/** The handover checklist under way for a rental; back to the rental if there is none. */
export default async function HandoverPage(props: { params: Promise<{ rentalId: string }> }) {
  const user = await requireUser();
  const { rentalId } = await props.params;
  if (!isRecordId(rentalId)) {
    notFound();
  }
  const status = await loadRentalHandoverStatus(appDb, user.operatorId, rentalId);
  const view = status.inProgressId
    ? await loadHandover(appDb, user.operatorId, status.inProgressId)
    : null;
  if (!view) {
    redirect(rentalPath(rentalId));
  }
  const checks = await acceptanceChecks(user, view);
  return (
    <AppShell user={user}>
      <PageHeader
        backHref={rentalPath(rentalId)}
        backLabel="the rental"
        title={`Handover: ${view.carRego}`}
      />
      <p className="text-muted-foreground mb-6 text-sm">
        For {view.renterFullName}. Everything is kept on this phone as you go, and sent when there
        is signal.
      </p>
      <OfflineReady>
        <HandoverChecklist
          data={checklistData(view, checks)}
          lastKilometres={view.lastKilometres}
        />
      </OfflineReady>
    </AppShell>
  );
}
