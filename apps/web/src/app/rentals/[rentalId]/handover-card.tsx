import {
  canSwapCar,
  formatDateTimeInTimeZone,
  type InspectionKind,
  type RentalStatus,
} from "@fleetapp/core";
import { withTenant } from "@fleetapp/db/tenant-context";
import { Badge } from "@fleetapp/ui/badge";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { ClipboardCheck, FileCheck2, XCircle } from "lucide-react";
import Link from "next/link";

import { appDb } from "../../../lib/app-db";
import { loadRentalHandoverStatus } from "../../../lib/handover/handover-queries";
import { rentalDocumentPath, rentalHandoverPath, rentalReturnPath } from "../../../lib/paths";
import { swapUnderWay } from "../../../lib/rentals/car-swaps";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { SignedInUser } from "../../../lib/require-user";
import { cancelHandoverAction, startHandoverAction } from "./handover/actions";
import { cancelReturnAction, startReturnAction } from "./return/actions";

const SWAP_FIRST = "A car swap is under way. Finish or cancel it first.";

/** How each checklist reads on the rental's page, and what it starts from. */
interface ChecklistCardWording {
  title: string;
  /** The rental's status the checklist begins from. */
  startsFrom: RentalStatus;
  description: string;
  doneDescription: (at: string) => string;
  doneBadge: string;
  verb: string;
  report: { kind: "handover_report" | "return_report"; label: string };
  path: (rentalId: string) => string;
  start: (rentalId: string) => Promise<void>;
  cancel: (rentalId: string, inspectionId: string) => Promise<void>;
}

const WORDING: Readonly<Record<InspectionKind, ChecklistCardWording>> = {
  handover: {
    title: "Handover",
    startsFrom: "booked",
    description:
      "On your phone, with the Renter at the car: photos, kilometres, fuel and damage, then the Renter signs to accept it. It keeps working with poor signal.",
    doneDescription: (at) =>
      `The Renter accepted the car on ${at}. The report is fixed and was emailed to them and to you.`,
    doneBadge: "Handed over",
    verb: "handover",
    report: { kind: "handover_report", label: "Open handover report" },
    path: rentalHandoverPath,
    start: startHandoverAction,
    cancel: cancelHandoverAction,
  },
  return: {
    title: "Return",
    startsFrom: "active",
    description:
      "When the car comes back: the same photos beside the handover's, kilometres, fuel and any new damage, then the return time and the Renter's signature if they are there. It keeps working with poor signal.",
    doneDescription: (at) =>
      `The car came back on ${at}. The report is fixed and was emailed to the Renter and to you.`,
    doneBadge: "Returned",
    verb: "return",
    report: { kind: "return_report", label: "Open return report" },
    path: rentalReturnPath,
    start: startReturnAction,
    cancel: cancelReturnAction,
  },
};

function DoneCard(props: { wording: ChecklistCardWording; rentalId: string; at: string }) {
  const { wording } = props;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{wording.title}</CardTitle>
        <CardDescription>{wording.doneDescription(props.at)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p>
          <Badge tone="good">{wording.doneBadge}</Badge>
        </p>
        <Button asChild variant="outline" className="w-full sm:w-auto sm:self-start">
          <a
            href={rentalDocumentPath(props.rentalId, wording.report.kind)}
            target="_blank"
            rel="noopener"
          >
            <FileCheck2 aria-hidden />
            {wording.report.label}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * One of the car's checklists on the rental's page: start it (from booked
 * for the handover, from out for the return) or carry on with the one under
 * way; once finished, when, and its report.
 */
async function ChecklistCard(props: {
  kind: InspectionKind;
  rental: RentalDetail;
  user: SignedInUser;
  doneAt: Date | null;
  /** Why it cannot start now (a car swap under way), shown instead of the start button. */
  waitingFor?: string | null;
}) {
  const wording = WORDING[props.kind];
  const { rental, user } = props;
  if (props.doneAt) {
    return (
      <DoneCard
        wording={wording}
        rentalId={rental.id}
        at={formatDateTimeInTimeZone(props.doneAt, user.operatorTimezone)}
      />
    );
  }
  if (rental.status !== wording.startsFrom) {
    return null;
  }
  const status = await loadRentalHandoverStatus(appDb, user.operatorId, rental.id, props.kind);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{wording.title}</CardTitle>
        <CardDescription>{wording.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row">
        {status.inProgressId ? (
          <>
            <Button asChild className="w-full sm:w-auto">
              <Link href={wording.path(rental.id)}>
                <ClipboardCheck aria-hidden />
                Continue {wording.verb}
              </Link>
            </Button>
            <form action={wording.cancel.bind(null, rental.id, status.inProgressId)}>
              <Button type="submit" variant="danger" className="w-full sm:w-auto">
                <XCircle aria-hidden />
                Cancel this {wording.verb}
              </Button>
            </form>
          </>
        ) : props.waitingFor ? (
          <p className="text-muted-foreground text-sm">{props.waitingFor}</p>
        ) : (
          <form action={wording.start.bind(null, rental.id)}>
            <Button type="submit" className="w-full sm:w-auto">
              <ClipboardCheck aria-hidden />
              Start {wording.verb}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** The car changing hands at the start: the checklist, then the Renter's acceptance and report. */
export function HandoverCard({ rental, user }: { rental: RentalDetail; user: SignedInUser }) {
  return <ChecklistCard kind="handover" rental={rental} user={user} doneAt={rental.handedOverAt} />;
}

/** The car coming back: the checklist beside the handover's, then the return report. */
export async function ReturnCard({ rental, user }: { rental: RentalDetail; user: SignedInUser }) {
  const swap = canSwapCar(rental.status)
    ? await withTenant(appDb, user.operatorId, (tx) => swapUnderWay(tx, user.operatorId, rental.id))
    : null;
  return (
    <ChecklistCard
      kind="return"
      rental={rental}
      user={user}
      doneAt={rental.returnedAt}
      waitingFor={swap ? SWAP_FIRST : null}
    />
  );
}
