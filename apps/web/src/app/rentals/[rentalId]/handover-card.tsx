import { canSwapCar, type InspectionKind } from "@fleetapp/core";
import { withTenant } from "@fleetapp/db/tenant-context";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Button, type ButtonProps } from "@fleetapp/ui/button";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { ConfirmButton } from "@fleetapp/ui/confirm-button";
import { Card, CardContent, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";
import { ClipboardCheck, XCircle } from "lucide-react";
import Link from "next/link";

import { appDb } from "../../../lib/app-db";
import { loadRentalHandoverStatus } from "../../../lib/handover/handover-queries";
import { rentalHandoverPath, rentalReturnPath } from "../../../lib/paths";
import { swapUnderWay } from "../../../lib/rentals/car-swaps";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { SignedInUser } from "../../../lib/require-user";
import { cancelHandoverAction, startHandoverAction } from "./handover/actions";
import { cancelReturnAction, startReturnAction } from "./return/actions";

const SWAP_FIRST = "A car swap is under way. Finish or cancel it first.";

/** How each checklist is started, carried on and stopped from the rental's page. */
interface ChecklistWording {
  verb: string;
  path: (rentalId: string) => string;
  start: (rentalId: string, previous: ChangeFormState) => Promise<ChangeFormState>;
  cancel: (rentalId: string, inspectionId: string) => Promise<void>;
}

const WORDING: Readonly<Record<InspectionKind, ChecklistWording>> = {
  handover: {
    verb: "handover",
    path: rentalHandoverPath,
    start: startHandoverAction,
    cancel: cancelHandoverAction,
  },
  return: {
    verb: "return",
    path: rentalReturnPath,
    start: startReturnAction,
    cancel: cancelReturnAction,
  },
};

/** The checklist's main button: start it, or carry on with the one under way. */
export function ChecklistMainButton(props: {
  kind: InspectionKind;
  rentalId: string;
  inProgressId: string | null;
  variant?: ButtonProps["variant"];
}) {
  const wording = WORDING[props.kind];
  const classes = "w-full md:w-auto";
  if (props.inProgressId) {
    return (
      <Button asChild variant={props.variant} className={classes}>
        <Link href={wording.path(props.rentalId)}>
          <ClipboardCheck aria-hidden />
          Continue {wording.verb}
        </Link>
      </Button>
    );
  }
  return (
    <ActionButton
      action={wording.start.bind(null, props.rentalId)}
      label={`Start ${wording.verb}`}
      pendingLabel="Starting…"
      variant={props.variant ?? "default"}
      icon={<ClipboardCheck aria-hidden />}
      className={classes}
    />
  );
}

/** Stops the checklist under way; what was taken so far is thrown away. */
export function CancelChecklistButton(props: {
  kind: InspectionKind;
  rentalId: string;
  inProgressId: string;
}) {
  const wording = WORDING[props.kind];
  return (
    <ConfirmButton
      label={`Cancel this ${wording.verb}`}
      icon={<XCircle aria-hidden />}
      title={`Cancel this ${wording.verb}?`}
      description="The photos and damage marks taken so far are thrown away."
      confirmLabel={`Yes, cancel the ${wording.verb}`}
      pendingLabel="Cancelling…"
      keepLabel={`No, keep the ${wording.verb}`}
      action={wording.cancel.bind(null, props.rentalId, props.inProgressId)}
    />
  );
}

/** Where the rental's return stands while the car is out: under way, or waiting for a swap. */
export interface ReturnProgress {
  inProgressId: string | null;
  isSwapUnderWay: boolean;
}

export async function loadReturnProgress(
  rental: RentalDetail,
  user: SignedInUser,
): Promise<ReturnProgress | null> {
  if (rental.status !== "active") {
    return null;
  }
  const [status, swap] = await Promise.all([
    loadRentalHandoverStatus(appDb, user.operatorId, rental.id, "return"),
    canSwapCar(rental.status)
      ? withTenant(appDb, user.operatorId, (tx) => swapUnderWay(tx, user.operatorId, rental.id))
      : Promise.resolve(null),
  ]);
  return { inProgressId: status.inProgressId, isSwapUnderWay: swap !== null };
}

/**
 * The return on the Overview, once there is something to say: a return
 * under way (carry on from the strip, or cancel it here), or one waiting
 * for a car swap to finish. Its start button is on the navy strip; its
 * report is on the Papers tab.
 */
export function ReturnCard({ rentalId, progress }: { rentalId: string; progress: ReturnProgress }) {
  if (!progress.isSwapUnderWay && !progress.inProgressId) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <SectionLabel>Return</SectionLabel>
        <CardDescription>
          {progress.inProgressId
            ? "A return is under way. Carry on with it from Continue return at the top."
            : SWAP_FIRST}
        </CardDescription>
      </CardHeader>
      {progress.inProgressId ? (
        <CardContent>
          <CancelChecklistButton
            kind="return"
            rentalId={rentalId}
            inProgressId={progress.inProgressId}
          />
        </CardContent>
      ) : null}
    </Card>
  );
}
