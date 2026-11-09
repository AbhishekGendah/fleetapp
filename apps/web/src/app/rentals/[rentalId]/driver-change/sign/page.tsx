import type { Metadata } from "next";
import {
  FUEL_LEVEL_LABELS,
  formatKilometres,
  operatorSettingsSchema,
  readSettings,
  type BookingProblem,
} from "@fleetapp/core";
import { CircleCheck, XCircle } from "lucide-react";
import Link from "next/link";

import { AppShell } from "../../../../app-shell";
import { DetailLines } from "../../../../../components/detail-lines";
import { NoBusinessEmailWarning } from "../../../../../components/no-business-email-warning";
import { RenterPrivacyLine } from "../../../../../components/renter-privacy-notice";
import { SectionCard } from "../../../../../components/section-card";
import { appDb } from "../../../../../lib/app-db";
import { shownChecklistOf } from "../../../../../lib/handover/checklist-fingerprint";
import {
  loadIncomingDriverProblems,
  shownDriverChangeOf,
  type DriverChangeViews,
} from "../../../../../lib/handover/complete-driver-change";
import { businessAcceptanceOf } from "../../../../../lib/handover/handover-queries";
import { rentalDriverChangePath } from "../../../../../lib/paths";
import { loadNoticeBusiness } from "../../../../../lib/privacy/notice-business";
import {
  bookingProblemMessage,
  RENTAL_PARTY_MISSING_MESSAGES,
} from "../../../../../lib/rentals/rental-messages";
import { gapsMessage } from "../../handover/handover-state";
import { CancelDriverChangeButton } from "../cancel-driver-change-button";
import { loadDriverChangePage, stripOf } from "../driver-change-strip";
import { LazyDriverChangeSigningForm } from "../lazy-driver-change-signing-form";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Change driver: sign" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "8, from the check-in": every photo the car's check-in has, kept once (rule 21). */
function photoCountText(views: DriverChangeViews): string {
  const count = views.returned.photos.size;
  return `${count}, from the check-in`;
}

/** The car as the new driver takes it: the check-in's readings and the damage already on it. */
function TakenOverCard({ views }: { views: DriverChangeViews }) {
  const { takenOver, returned } = views;
  return (
    <SectionCard heading={`The car, as ${takenOver.driverFullName ?? "the new driver"} takes it`}>
      <div className="pb-3">
        <DetailLines
          lines={[
            ["Car", `${returned.carRego} · ${returned.carMakeModel}`],
            ["Odometer", formatKilometres(returned.odometerKm ?? 0)],
            ["Fuel", returned.fuelLevel ? FUEL_LEVEL_LABELS[returned.fuelLevel] : ""],
            ["Keys", String(returned.keysCount ?? "")],
            ["Photos", photoCountText(views)],
            [
              "Damage",
              returned.damageMarks.length === 0
                ? "None new"
                : `${returned.damageMarks.length} new at the check-in`,
            ],
          ]}
        />
      </div>
    </SectionCard>
  );
}

/** The new driver's checks: each that stops the change in words, or the ones that passed. */
function ChecksCard(props: {
  name: string;
  business: string;
  problems: BookingProblem[] | string;
}) {
  const lines =
    typeof props.problems === "string"
      ? [{ isPassed: false, text: props.problems }]
      : props.problems.length === 0
        ? [
            { isPassed: true, text: `${props.name}'s licence and details pass the checks` },
            { isPassed: true, text: `${props.name} drives for ${props.business}` },
            { isPassed: true, text: `${props.name} isn't marked Do not rent` },
          ]
        : props.problems.map((problem) => ({
            isPassed: problem.level === "notice",
            text: bookingProblemMessage(problem, true),
          }));
  return (
    <SectionCard heading="Checks">
      <ul className="flex flex-col gap-2 pb-4">
        {lines.map((line) => (
          <li key={line.text} className="flex items-start gap-2 text-sm">
            {line.isPassed ? (
              <CircleCheck aria-hidden className="text-teal mt-0.5 size-4 shrink-0" />
            ) : (
              <XCircle aria-hidden className="text-destructive mt-0.5 size-4 shrink-0" />
            )}
            <span>
              <span className="sr-only">{line.isPassed ? "Passed: " : "Stops it: "}</span>
              {line.text}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/**
 * A driver change's last step (mockup 7): the car as the new driver takes
 * it, their checks, then both drivers sign and the change is finished.
 */
export default async function DriverChangeSignPage(props: {
  params: Promise<{ rentalId: string }>;
}) {
  const { user, rentalId, views } = await loadDriverChangePage(props.params);
  const clock = { timeZone: user.operatorTimezone, now: new Date() };
  const [found, business] = await Promise.all([
    loadIncomingDriverProblems({ database: appDb }, user.operatorId, views, clock),
    loadNoticeBusiness(appDb, user.operatorId),
  ]);
  const problems = typeof found === "string" ? RENTAL_PARTY_MISSING_MESSAGES[found] : found;
  const isBlocked =
    typeof problems === "string" || problems.some((problem) => problem.level !== "notice");
  const { returned, takenOver } = views;
  const checkIn = shownChecklistOf(returned);
  const settings = readSettings(operatorSettingsSchema, returned.settingsSnapshot);
  const incomingName = takenOver.driverFullName ?? "";
  const outgoingName = returned.driverFullName ?? "";
  const isCheckInDone = checkIn !== null && returned.gaps.length === 0;
  return (
    <AppShell user={user} strip={stripOf(views, 2)}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <NoBusinessEmailWarning user={user} />
        <TakenOverCard views={views} />
        <ChecksCard name={incomingName} business={returned.renterShownName} problems={problems} />
        <SectionCard heading="Signatures">
          <div className="pb-4">
            {!isCheckInDone ? (
              <p className="text-sm">
                {returned.gaps.length > 0 ? gapsMessage(returned.gaps) : null}{" "}
                <Link
                  href={rentalDriverChangePath(rentalId, "check-in")}
                  className="text-teal hover:text-primary font-bold"
                >
                  Back to the check-in
                </Link>
              </p>
            ) : isBlocked ? (
              <p className="text-sm">
                {incomingName} can&apos;t take the car until the checks pass. Fix them, or cancel
                this change.
              </p>
            ) : (
              <LazyDriverChangeSigningForm
                rentalId={rentalId}
                returnInspectionId={returned.inspectionId}
                handoverInspectionId={takenOver.inspectionId}
                shown={shownDriverChangeOf(views)}
                car={`${returned.carRego} · ${returned.carMakeModel}`}
                checkIn={checkIn}
                outgoing={{ name: outgoingName, forBusiness: businessAcceptanceOf(returned) }}
                incoming={{ name: incomingName, forBusiness: businessAcceptanceOf(takenOver) }}
                isOutgoingSignatureRequired={settings.isRenterSignatureAtReturnRequired}
                privacyLine={<RenterPrivacyLine business={business} />}
              />
            )}
          </div>
        </SectionCard>
        <p className="bg-muted rounded-md p-3 text-sm">
          The check-in report goes to {outgoingName}, the handover report to {incomingName}, and
          both to {returned.renterGreetingName} at {returned.renterShownName} and to you.
        </p>
        <CancelDriverChangeButton rentalId={rentalId} />
      </div>
    </AppShell>
  );
}
