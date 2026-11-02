import { canSwapCar, formatDateTimeInTimeZone } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { ArrowLeftRight, ClipboardCheck, FileCheck2, XCircle } from "lucide-react";
import Link from "next/link";

import { appDb } from "../../../lib/app-db";
import { loadRentalHandoverStatus } from "../../../lib/handover/handover-queries";
import { CONTRACTS_PATH, rentalDocumentPath, rentalSwapPath } from "../../../lib/paths";
import { listRentalSwaps, type SwapSummary } from "../../../lib/rentals/car-swaps";
import { listPickableCars } from "../../../lib/rentals/pickable-records";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import { loadDefaultTemplate } from "../../../lib/contracts/templates";
import type { SignedInUser } from "../../../lib/require-user";
import { cancelSwapAction, startSwapAction } from "./swap/swap-actions";
import { LazyStartSwapForm } from "./swap/lazy-start-swap-form";

/** One finished swap: which cars, when, why, and its signed form. */
function SwapItem(props: { swap: SwapSummary; rentalId: string; timeZone: string }) {
  const { swap } = props;
  return (
    <RecordItem
      title={`${swap.fromRego} → ${swap.toRego}`}
      aside={<Badge tone="good">Swapped</Badge>}
      details={
        <>
          <p>{swap.reason}</p>
          {swap.swappedAt ? (
            <p>Swapped {formatDateTimeInTimeZone(swap.swappedAt, props.timeZone)}</p>
          ) : null}
        </>
      }
      actions={
        swap.documentId ? (
          <Button asChild variant="outline">
            <a
              href={rentalDocumentPath(props.rentalId, "swap_form", swap.documentId)}
              target="_blank"
              rel="noopener"
            >
              <FileCheck2 aria-hidden />
              Open swap form
            </a>
          </Button>
        ) : null
      }
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
        <form action={cancelSwapAction.bind(null, rentalId)}>
          <Button type="submit" variant="danger" className="w-full sm:w-auto">
            <XCircle aria-hidden />
            Cancel swap
          </Button>
        </form>
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
        <Link href={CONTRACTS_PATH} className="text-teal underline">
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
 * while the rental's own return is under way.
 */
export async function SwapCard({ rental, user }: { rental: RentalDetail; user: SignedInUser }) {
  const isSwappable = canSwapCar(rental.status);
  const [swaps, returnStatus] = await Promise.all([
    listRentalSwaps(appDb, user.operatorId, rental.id),
    isSwappable
      ? loadRentalHandoverStatus(appDb, user.operatorId, rental.id, "return")
      : Promise.resolve(null),
  ]);
  const underWay = swaps.find((swap) => swap.status === "in_progress");
  const finished = swaps.filter((swap) => swap.status === "completed");
  const canStart = isSwappable && !returnStatus?.inProgressId;
  if (!canStart && finished.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Car swap</CardTitle>
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
              />
            ))}
          </RecordList>
        ) : null}
      </CardContent>
    </Card>
  );
}
