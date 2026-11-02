import { operatorSettingsSchema, readSettings } from "@fleetapp/core";
import { PageHeader } from "@fleetapp/ui/page-header";
import { redirect } from "next/navigation";

import { AppShell } from "../../../app-shell";
import { appDb } from "../../../../lib/app-db";
import { loadCompletedHandover } from "../../../../lib/handover/handover-queries";
import { initialReturnValues } from "../../../../lib/handover/return-input";
import { rentalPath } from "../../../../lib/paths";
import { checklistData } from "../handover/checklist-page-data";
import { HandoverChecklist } from "../handover/handover-checklist";
import { loadChecklistPage } from "../handover/load-checklist-page";
import { OfflineReady } from "../handover/offline-ready";
import { comparisonWith } from "./comparison";
import { LazyReturnForm } from "./lazy-return-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The return checklist under way for a rental; back to the rental if there is none. */
export default async function ReturnPage(props: { params: Promise<{ rentalId: string }> }) {
  const { user, rentalId, view } = await loadChecklistPage(props.params, "return");
  const handover = await loadCompletedHandover(appDb, user.operatorId, {
    rentalId,
    vehicleId: view.vehicleId,
  });
  if (!handover) {
    redirect(rentalPath(rentalId));
  }
  const settings = readSettings(operatorSettingsSchema, view.settingsSnapshot);
  return (
    <AppShell user={user}>
      <PageHeader
        backHref={rentalPath(rentalId)}
        backLabel="the rental"
        title={`Return: ${view.carRego}`}
      />
      <p className="text-muted-foreground mb-6 text-sm">
        From {view.renterFullName}. Each step shows the handover beside it. Everything is kept on
        this phone as you go, and sent when there is signal.
      </p>
      <OfflineReady>
        <HandoverChecklist
          data={checklistData(view, { blockers: [], bondShortCents: null })}
          lastKilometres={view.lastKilometres}
          comparison={comparisonWith(handover)}
          damageTitle="New damage"
          finalStep={{
            title: "The car is back",
            form: (
              <LazyReturnForm
                rentalId={rentalId}
                inspectionId={view.inspectionId}
                renterName={view.renterFullName}
                summary={`${view.carRego} · ${view.carMakeModel}`}
                timeZone={user.operatorTimezone}
                initialValues={initialReturnValues(new Date(), user.operatorTimezone)}
                isSignatureRequired={settings.isRenterSignatureAtReturnRequired}
              />
            ),
          }}
        />
      </OfflineReady>
    </AppShell>
  );
}
