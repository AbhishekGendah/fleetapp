import type { Metadata } from "next";
import { firstNameOf } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AppShell } from "../../../../app-shell";
import { rentalDriverChangePath } from "../../../../../lib/paths";
import { checklistData } from "../../handover/checklist-page-data";
import { HandoverChecklist } from "../../handover/handover-checklist";
import { OfflineReady } from "../../handover/offline-ready";
import { comparisonWith } from "../../return/comparison";
import { CancelDriverChangeButton } from "../cancel-driver-change-button";
import { loadDriverChangePage, stripOf } from "../driver-change-strip";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Change driver: check in" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A driver change's second step (mockup 7): the car checked in from the
 * driver who has it, as a return beside its handover. Kept on this phone as
 * it goes and sent when there is signal (rule 25).
 */
export default async function DriverChangeCheckInPage(props: {
  params: Promise<{ rentalId: string }>;
}) {
  const { user, rentalId, views } = await loadDriverChangePage(props.params);
  const { returned, before, takenOver } = views;
  const toFirstName = firstNameOf(takenOver.driverFullName ?? "the new driver");
  return (
    <AppShell user={user} strip={stripOf(views, 1)}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          {returned.driverFullName} hands back {returned.carRego} ({views.change.reason}). Each step
          shows the handover beside it. Everything is kept on this phone as you go, and sent when
          there is signal.
        </p>
        <OfflineReady>
          <HandoverChecklist
            data={checklistData(returned, { blockers: [] })}
            lastKilometres={returned.lastKilometres}
            comparison={comparisonWith(before)}
            damageTitle="New damage"
            finalStep={{
              title: `Next: ${toFirstName} signs`,
              form: (
                <Button asChild className="w-full">
                  <Link href={rentalDriverChangePath(rentalId, "sign")}>
                    Next: {toFirstName} signs
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
              ),
            }}
          />
        </OfflineReady>
        <CancelDriverChangeButton rentalId={rentalId} />
      </div>
    </AppShell>
  );
}
