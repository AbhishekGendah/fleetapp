import { formatDateTimeInTimeZone } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { ClipboardCheck, FileCheck2, XCircle } from "lucide-react";
import Link from "next/link";

import { appDb } from "../../../lib/app-db";
import { loadRentalHandoverStatus } from "../../../lib/handover/handover-queries";
import { rentalDocumentPath, rentalHandoverPath } from "../../../lib/paths";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { SignedInUser } from "../../../lib/require-user";
import { cancelHandoverAction, startHandoverAction } from "./handover/actions";

function HandedOverCard({ rentalId, at }: { rentalId: string; at: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Handover</CardTitle>
        <CardDescription>
          The Renter accepted the car on {at}. The report is fixed and was emailed to them and to
          you.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p>
          <Badge tone="good">Handed over</Badge>
        </p>
        <Button asChild variant="outline" className="w-full sm:w-auto sm:self-start">
          <a href={rentalDocumentPath(rentalId, "handover_report")} target="_blank" rel="noopener">
            <FileCheck2 aria-hidden />
            Open handover report
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * The car changing hands: start the checklist on a booked rental (or carry
 * on with the one under way), and once the Renter has accepted, the report.
 */
export async function HandoverCard({ rental, user }: { rental: RentalDetail; user: SignedInUser }) {
  const status = await loadRentalHandoverStatus(appDb, user.operatorId, rental.id);
  if (status.completedAt) {
    return (
      <HandedOverCard
        rentalId={rental.id}
        at={formatDateTimeInTimeZone(status.completedAt, user.operatorTimezone)}
      />
    );
  }
  if (rental.status !== "booked") {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Handover</CardTitle>
        <CardDescription>
          On your phone, with the Renter at the car: photos, kilometres, fuel and damage, then the
          Renter signs to accept it. It keeps working with poor signal.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row">
        {status.inProgressId ? (
          <>
            <Button asChild className="w-full sm:w-auto">
              <Link href={rentalHandoverPath(rental.id)}>
                <ClipboardCheck aria-hidden />
                Continue handover
              </Link>
            </Button>
            <form action={cancelHandoverAction.bind(null, rental.id, status.inProgressId)}>
              <Button type="submit" variant="danger" className="w-full sm:w-auto">
                <XCircle aria-hidden />
                Cancel this handover
              </Button>
            </form>
          </>
        ) : (
          <form action={startHandoverAction.bind(null, rental.id)}>
            <Button type="submit" className="w-full sm:w-auto">
              <ClipboardCheck aria-hidden />
              Start handover
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
