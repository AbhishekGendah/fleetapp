import { driverChangeStepNames, firstNameOf, isRecordId } from "@fleetapp/core";
import { RecordStrip } from "@fleetapp/ui/record-strip";
import { notFound, redirect } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import {
  loadDriverChangeViews,
  type DriverChangeViews,
} from "../../../../lib/handover/complete-driver-change";
import { rentalPath } from "../../../../lib/paths";
import { requireUser, type SignedInUser } from "../../../../lib/require-user";

/** Which of the flow's three steps a page is (mockup 7). */
export type DriverChangeStep = 0 | 1 | 2;

/**
 * The navy strip over each step of a driver change (mockup 7): "Change
 * driver", the car, the business and the driver who has it now, and which
 * step this is.
 */
export function DriverChangeStrip(props: {
  rentalId: string;
  carRego: string;
  businessName: string;
  fromName: string;
  toName: string | null;
  step: DriverChangeStep;
}) {
  return (
    <RecordStrip
      backHref={rentalPath(props.rentalId)}
      backLabel={`Rental of ${props.carRego}`}
      title="Change driver"
      subtitle={`${props.carRego} · ${props.businessName} · driver ${props.fromName}`}
      steps={{
        names: driverChangeStepNames(
          firstNameOf(props.fromName),
          props.toName ? firstNameOf(props.toName) : "New driver",
        ),
        current: props.step,
      }}
    />
  );
}

/** The driver change under way and its checklists; back to the rental if there is none. */
export async function loadDriverChangePage(
  params: Promise<{ rentalId: string }>,
): Promise<{ user: SignedInUser; rentalId: string; views: DriverChangeViews }> {
  const user = await requireUser();
  const { rentalId } = await params;
  if (!isRecordId(rentalId)) {
    notFound();
  }
  const views = await loadDriverChangeViews({ database: appDb }, user.operatorId, rentalId);
  if (!views) {
    redirect(rentalPath(rentalId));
  }
  return { user, rentalId, views };
}

/** The strip for a step of the change under way. */
export function stripOf(views: DriverChangeViews, step: DriverChangeStep) {
  const { returned, takenOver } = views;
  return (
    <DriverChangeStrip
      rentalId={returned.rentalId}
      carRego={returned.carRego}
      businessName={returned.renterShownName}
      fromName={returned.driverFullName ?? ""}
      toName={takenOver.driverFullName}
      step={step}
    />
  );
}
