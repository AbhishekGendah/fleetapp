import { Button } from "@fleetapp/ui/button";
import { PageHeader } from "@fleetapp/ui/page-header";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "../../../../app-shell";
import { appDb } from "../../../../../lib/app-db";
import { loadCompletedHandover } from "../../../../../lib/handover/handover-queries";
import { rentalPath, rentalSwapPath } from "../../../../../lib/paths";
import { checklistData } from "../../handover/checklist-page-data";
import { HandoverChecklist } from "../../handover/handover-checklist";
import { OfflineReady } from "../../handover/offline-ready";
import { comparisonWith } from "../../return/comparison";
import { loadSwapPage } from "../load-swap-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A swap's first step: the car handed back, checked as a return beside its handover. */
export default async function SwapOldCarPage(props: { params: Promise<{ rentalId: string }> }) {
  const { user, rentalId, swap, view } = await loadSwapPage(props.params, "old");
  const handover = await loadCompletedHandover(appDb, user.operatorId, {
    rentalId,
    vehicleId: view.vehicleId,
  });
  if (!handover) {
    redirect(rentalPath(rentalId));
  }
  return (
    <AppShell user={user}>
      <PageHeader
        backHref={rentalPath(rentalId)}
        backLabel="the rental"
        title={`Swap, 1 of 2: ${view.carRego} back`}
      />
      <p className="text-muted-foreground mb-6 text-sm">
        {view.renterFullName} hands back {view.carRego} ({swap.reason}). Each step shows the
        handover beside it. Everything is kept on this phone as you go.
      </p>
      <OfflineReady>
        <HandoverChecklist
          data={checklistData(view, { blockers: [], bondShortCents: null })}
          lastKilometres={view.lastKilometres}
          comparison={comparisonWith(handover)}
          damageTitle="New damage"
          finalStep={{
            title: "Next: the new car",
            form: (
              <Button asChild className="w-full">
                <Link href={rentalSwapPath(rentalId, "new")}>
                  Check the new car
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            ),
          }}
        />
      </OfflineReady>
    </AppShell>
  );
}
