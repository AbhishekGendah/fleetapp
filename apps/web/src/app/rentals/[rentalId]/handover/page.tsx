import { PageHeader } from "@fleetapp/ui/page-header";

import { AppShell } from "../../../app-shell";
import { appDb } from "../../../../lib/app-db";
import { loadSigningStatus } from "../../../../lib/contracts/signing-links";
import type { HandoverView } from "../../../../lib/handover/handover-queries";
import { rentalPath } from "../../../../lib/paths";
import { loadRentalProblems } from "../../../../lib/rentals/booking-checks";
import { bookingProblemMessage } from "../../../../lib/rentals/rental-messages";
import type { SignedInUser } from "../../../../lib/require-user";
import { checklistData } from "./checklist-page-data";
import { loadChecklistPage } from "./load-checklist-page";
import { AcceptanceForm } from "./acceptance-form";
import { HandoverChecklist } from "./handover-checklist";
import { OfflineReady } from "./offline-ready";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNSIGNED_MESSAGE =
  "The Renter has not signed the contract yet: send it from the rental's page.";

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

/** The handover checklist under way for a rental; back to the rental if there is none. */
export default async function HandoverPage(props: { params: Promise<{ rentalId: string }> }) {
  const { user, rentalId, view } = await loadChecklistPage(props.params, "handover");
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
          damageTitle="Damage already on the car"
          finalStep={{
            title: "The Renter accepts the car",
            form: (
              <AcceptanceForm
                rentalId={view.rentalId}
                inspectionId={view.inspectionId}
                renterName={view.renterFullName}
                summary={`${view.carRego} · ${view.carMakeModel}`}
                bondShortCents={checks.bondShortCents}
              />
            ),
          }}
        />
      </OfflineReady>
    </AppShell>
  );
}
