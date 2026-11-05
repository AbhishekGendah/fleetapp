import { PageHeader } from "@fleetapp/ui/page-header";

import { AppShell } from "../../../../app-shell";
import { appDb } from "../../../../../lib/app-db";
import { loadReturn } from "../../../../../lib/handover/handover-queries";
import { rentalSwapPath } from "../../../../../lib/paths";
import { checklistData } from "../../handover/checklist-page-data";
import { HandoverChecklist } from "../../handover/handover-checklist";
import { OfflineReady } from "../../handover/offline-ready";
import { loadSwapSigningView } from "../../../../../lib/handover/complete-swap";
import { SwapSigningStep } from "../swap-signing-step";
import { loadSwapPage } from "../load-swap-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A swap's second step: the new car checked out as a handover, then the Renter signs. */
export default async function SwapNewCarPage(props: { params: Promise<{ rentalId: string }> }) {
  const { user, rentalId, swap, view } = await loadSwapPage(props.params, "new");
  const [oldCar, signing] = await Promise.all([
    loadReturn(appDb, user.operatorId, swap.returnInspectionId),
    loadSwapSigningView({ database: appDb }, user.operatorId, rentalId, {
      timeZone: user.operatorTimezone,
      now: new Date(),
    }),
  ]);
  const oldCarText = oldCar ? `${oldCar.carRego} · ${oldCar.carMakeModel}` : "the old car";
  const oldCarGaps = oldCar?.gaps.length ?? 0;
  return (
    <AppShell user={user}>
      <PageHeader
        backHref={rentalSwapPath(rentalId, "old")}
        backLabel="the car handed back"
        title={`Swap, 2 of 2: ${view.carRego} out`}
      />
      <p className="text-muted-foreground mb-6 text-sm">
        For {view.renterFullName}. Everything is kept on this phone as you go, and sent when there
        is signal.
        {oldCarGaps > 0
          ? ` The car handed back still needs ${oldCarGaps} more things: go back to finish it.`
          : ""}
      </p>
      <OfflineReady>
        <HandoverChecklist
          data={checklistData(view, { blockers: [], bondShortCents: null })}
          lastKilometres={view.lastKilometres}
          damageTitle="Damage already on the car"
          finalStep={{
            title: "The Renter signs the swap",
            form: (
              <SwapSigningStep
                rentalId={rentalId}
                signing={signing}
                renterName={view.renterFullName}
                oldCar={oldCarText}
                newCar={`${view.carRego} · ${view.carMakeModel}`}
              />
            ),
          }}
        />
      </OfflineReady>
    </AppShell>
  );
}
