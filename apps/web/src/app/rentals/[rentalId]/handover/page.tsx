import { formatCents, handoverBlockers, type BookingProblem } from "@fleetapp/core";
import { PageHeader } from "@fleetapp/ui/page-header";

import { AppShell } from "../../../app-shell";
import { appDb } from "../../../../lib/app-db";
import { loadSigningStatus } from "../../../../lib/contracts/signing-links";
import { shownChecklistOf } from "../../../../lib/handover/checklist-fingerprint";
import {
  isOverridableProblem,
  OVERRIDE_REASON_FIELDS,
} from "../../../../lib/handover/override-reasons";
import type { HandoverView } from "../../../../lib/handover/handover-queries";
import { canHearRenterPayments } from "../../../../lib/payments/app-payments";
import { rentalPath } from "../../../../lib/paths";
import { loadRentalProblems } from "../../../../lib/rentals/booking-checks";
import type { BookingClash } from "../../../../lib/rentals/car-holds";
import {
  bookingClashMessage,
  bookingProblemMessage,
} from "../../../../lib/rentals/rental-messages";
import { findEarlyClash } from "../../../../lib/handover/complete-handover";
import type { SignedInUser } from "../../../../lib/require-user";
import { NoBusinessEmailWarning } from "../../../../components/no-business-email-warning";
import { RenterPrivacyLine } from "../../../../components/renter-privacy-notice";
import { loadNoticeBusiness } from "../../../../lib/privacy/notice-business";
import { checklistData } from "./checklist-page-data";
import { loadChecklistPage } from "./load-checklist-page";
import { AcceptanceForm, type OverrideAsked } from "./acceptance-form";
import { OVERRIDE_REASON_NEEDED } from "./handover-state";
import { HandoverChecklist } from "./handover-checklist";
import { OfflineReady } from "./offline-ready";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNSIGNED_MESSAGE =
  "The Renter has not signed the contract yet: send it from the rental's page.";

/** Handing the car over before its start would take it from this booking. */
function earlyClashMessage(clash: BookingClash, timeZone: string): string {
  return `${bookingClashMessage(clash, timeZone).replace(" Choose other dates or another car.", "")} Hand it over at this rental's booked time, or move that booking.`;
}

const ARCHIVED_MESSAGES = {
  car_not_found: "The car has been archived. Restore it, or cancel this rental.",
  renter_not_found: "The Renter has been archived. Restore them, or cancel this rental.",
} as const;

/** The question the business answers to let the car go without this check. */
function overrideQuestion(
  problem: Extract<BookingProblem, { code: OverrideAsked["code"] }>,
): string {
  switch (problem.code) {
    case "bond_short":
      return `The bond is ${formatCents(problem.owingCents)} short. Why does the car go anyway?`;
    case "direct_debit_missing":
      return "The Renter's direct debit is not set up. Why does the car go anyway?";
    case "no_insurance":
      return "No insurance for this car is on file. Why does the car go anyway?";
    case "no_rego":
      return "No rego for this car is on file. Why does the car go anyway?";
  }
}

/**
 * What stops the acceptance beyond the checklist itself, checked as the
 * server will (review A6-1), and the checks a reason can override.
 */
async function acceptanceChecks(user: SignedInUser, view: HandoverView) {
  const clock = { timeZone: user.operatorTimezone, now: new Date() };
  const [signing, problems, earlyClash] = await Promise.all([
    loadSigningStatus(appDb, user.operatorId, view.rentalId, clock.now),
    loadRentalProblems(
      appDb,
      user.operatorId,
      { ...view, id: view.rentalId },
      clock,
      { canHearRenterPayments },
      true,
    ),
    // Shown before the Renter signs, not after (review A6-3).
    findEarlyClash({ database: appDb }, user.operatorId, view, clock.now),
  ]);
  const found = typeof problems === "string" ? [] : problems;
  const blockers = [
    ...(typeof problems === "string" ? [ARCHIVED_MESSAGES[problems]] : []),
    ...handoverBlockers(found).map(bookingProblemMessage),
    ...(earlyClash ? [earlyClashMessage(earlyClash, user.operatorTimezone)] : []),
  ];
  const overrides: OverrideAsked[] = found.filter(isOverridableProblem).map((problem) => ({
    code: problem.code,
    name: OVERRIDE_REASON_FIELDS[problem.code],
    label: overrideQuestion(problem),
    neededMessage: OVERRIDE_REASON_NEEDED[problem.code],
  }));
  return {
    blockers: signing.signed ? blockers : [UNSIGNED_MESSAGE, ...blockers],
    overrides,
  };
}

/** The handover checklist under way for a rental; back to the rental if there is none. */
export default async function HandoverPage(props: { params: Promise<{ rentalId: string }> }) {
  const { user, rentalId, view } = await loadChecklistPage(props.params, "handover");
  const [checks, business] = await Promise.all([
    acceptanceChecks(user, view),
    loadNoticeBusiness(appDb, user.operatorId),
  ]);
  const shown = shownChecklistOf(view);
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
      <NoBusinessEmailWarning user={user} />
      <OfflineReady>
        <HandoverChecklist
          data={checklistData(view, checks)}
          lastKilometres={view.lastKilometres}
          damageTitle="Damage already on the car"
          finalStep={{
            title: "The Renter accepts the car",
            // Shown only once the details are saved: the checklist's gaps say so until then.
            form: shown ? (
              <AcceptanceForm
                rentalId={view.rentalId}
                inspectionId={view.inspectionId}
                renterName={view.renterFullName}
                privacyLine={<RenterPrivacyLine business={business} />}
                summary={`${view.carRego} · ${view.carMakeModel}`}
                shown={shown}
                overrides={checks.overrides}
              />
            ) : null,
          }}
        />
      </OfflineReady>
    </AppShell>
  );
}
