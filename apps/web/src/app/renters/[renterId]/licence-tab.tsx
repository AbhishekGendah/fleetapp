import {
  expiryStatus,
  formatDateTimeInTimeZone,
  formatDayInTimeZone,
  LICENCE_CLASS_LABELS,
  LICENCE_SIDES,
  LICENCE_TYPE_LABELS,
  licenceScanDeleteAfter,
} from "@fleetapp/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { Pencil, Plus } from "lucide-react";

import { appDb } from "../../../lib/app-db";
import type { SignedInUser } from "../../../lib/require-user";
import { licenceFormValues } from "../../../lib/renters/licence-input";
import { listLicenceScans, listSidesDeletedByTimer } from "../../../lib/renters/licence-scans";
import { loadOperatorSettings } from "../../../lib/settings/operator-settings";
import { licenceIssuedInText } from "../../../lib/renters/licence-text";
import { RENTER_FIELD_LABELS } from "../../../lib/renters/renter-labels";
import type { RenterDetail } from "../../../lib/renters/renter-queries";
import type { ExpiryContext } from "../../../lib/vehicles/expiry-columns";
import { ExpiryDate } from "../../cars/expiry-date";
import { LicenceForm } from "./licence-form";
import { saveLicenceAction } from "./licence-actions";
import { LicenceScanSlots, type ScanSummary } from "./licence-scan-slots";

function LicenceDetails({ renter, expiry }: { renter: RenterDetail; expiry: ExpiryContext }) {
  if (!renter.licenceNumber || !renter.licenceClass || !renter.licenceType) {
    return <p className="text-muted-foreground text-sm">No licence on file yet.</p>;
  }
  const lines: readonly [string, React.ReactNode][] = [
    [
      RENTER_FIELD_LABELS.licenceIssuedIn,
      licenceIssuedInText(renter.licenceIssuedIn, renter.licenceCountry),
    ],
    [RENTER_FIELD_LABELS.licenceNumber, renter.licenceNumber],
    [RENTER_FIELD_LABELS.licenceClass, LICENCE_CLASS_LABELS[renter.licenceClass]],
    [RENTER_FIELD_LABELS.licenceType, LICENCE_TYPE_LABELS[renter.licenceType]],
    [
      RENTER_FIELD_LABELS.licenceExpiresOn,
      <ExpiryDate
        key="expires"
        date={renter.licenceExpiresOn}
        status={expiryStatus(renter.licenceExpiresOn, expiry.today, expiry.warningDays)}
      />,
    ],
  ];
  return (
    <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
      {lines.map(([label, value]) => (
        <div key={label} className="flex flex-col sm:contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A Renter's licence: its details, and the front and back scans kept privately. */
export async function LicenceTab(props: {
  renter: RenterDetail;
  user: SignedInUser;
  expiry: ExpiryContext;
}) {
  const { renter, user, expiry } = props;
  const isEditable = renter.archivedAt === null;
  const hasLicence = renter.licenceNumber !== null;
  const [scans, settings, sidesDeletedByTimer] = await Promise.all([
    listLicenceScans(appDb, user.operatorId, renter.id),
    loadOperatorSettings(appDb, user.operatorId),
    listSidesDeletedByTimer(appDb, user.operatorId, renter.id),
  ]);
  const keptMonths = settings.licenceScanKeptMonths;
  const scanSummaries = Object.fromEntries(
    LICENCE_SIDES.map((side) => {
      const scan = scans[side];
      const summary: ScanSummary | null = scan
        ? {
            id: scan.id,
            contentType: scan.contentType,
            addedText: formatDateTimeInTimeZone(scan.addedAt, user.operatorTimezone),
            // No rentals yet (Phase 3): counted from when it was added.
            keptUntilText: formatDayInTimeZone(
              licenceScanDeleteAfter(
                { addedAt: scan.addedAt, lastRentalEndedAt: null },
                keptMonths,
              ),
              user.operatorTimezone,
            ),
          }
        : null;
      return [side, summary];
    }),
  ) as Record<(typeof LICENCE_SIDES)[number], ScanSummary | null>;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Licence</CardTitle>
          <CardDescription>One licence per Renter. When they renew, edit it.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <LicenceDetails renter={renter} expiry={expiry} />
          {isEditable ? (
            <FormDialog
              triggerLabel={hasLicence ? "Edit licence" : "Add licence"}
              triggerIcon={hasLicence ? <Pencil aria-hidden /> : <Plus aria-hidden />}
              isMainAction={!hasLicence}
              title={hasLicence ? "Edit the licence" : "Add the licence"}
            >
              <LicenceForm
                initialValues={licenceFormValues(renter)}
                action={saveLicenceAction.bind(null, renter.id)}
                submitLabel="Save licence"
              />
            </FormDialog>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Front and back</CardTitle>
          <CardDescription>
            Kept in private storage. They only open when you press View, and every view is recorded
            in the Log with who looked. Deleted automatically {keptMonths}{" "}
            {keptMonths === 1 ? "month" : "months"} after the Renter&rsquo;s last rental, or after
            they were added (Settings → Renters).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LicenceScanSlots
            renterId={renter.id}
            scans={scanSummaries}
            sidesDeletedByTimer={sidesDeletedByTimer}
            keptMonths={keptMonths}
            isEditable={isEditable}
          />
        </CardContent>
      </Card>
    </>
  );
}
