import {
  expiryStatus,
  formatDateTimeInTimeZone,
  formatCalendarDate,
  LICENCE_CLASS_LABELS,
  LICENCE_SIDES,
  LICENCE_TYPE_LABELS,
  licenceScanDeleteAfter,
  todayInTimeZone,
} from "@fleetapp/core";
import { Card, CardContent, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { Pencil, Plus } from "lucide-react";

import { DetailLines } from "../../../components/detail-lines";
import { RENTAL_RETENTION_HOLDS } from "../../../lib/rentals/retention-holds";
import { loadRenterScanHold } from "../../../lib/renters/scan-retention";
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
import { monthsText } from "../../../lib/renters/licence-text";
import { LicenceScanSlots, type ScanSummary } from "./licence-scan-slots";

/**
 * The licence's details. Never its number (Abhi, 7 Nov 2026): it is only in
 * the Edit licence form, which the Operator opens on purpose to change it.
 */
function LicenceDetails({ renter, expiry }: { renter: RenterDetail; expiry: ExpiryContext }) {
  if (!renter.licenceNumber || !renter.licenceClass || !renter.licenceType) {
    return <p className="text-muted-foreground text-sm">No licence on file yet.</p>;
  }
  const lines: readonly [string, React.ReactNode][] = [
    [
      RENTER_FIELD_LABELS.licenceIssuedIn,
      licenceIssuedInText(renter.licenceIssuedIn, renter.licenceCountry),
    ],
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
  return <DetailLines lines={lines} />;
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
  const [scans, settings, sidesDeletedByTimer, hold] = await Promise.all([
    listLicenceScans(appDb, user.operatorId, renter.id),
    loadOperatorSettings(appDb, user.operatorId),
    listSidesDeletedByTimer(appDb, user.operatorId, renter.id),
    loadRenterScanHold(appDb, user.operatorId, renter.id, RENTAL_RETENTION_HOLDS),
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
            // The same holds and last-rental date as the nightly clean-up.
            keptUntilText: hold.isHeld
              ? null
              : formatCalendarDate(
                  todayInTimeZone(
                    licenceScanDeleteAfter(
                      { addedAt: scan.addedAt, lastRentalEndedAt: hold.lastRentalEndedAt },
                      keptMonths,
                    ),
                    user.operatorTimezone,
                  ),
                ),
          }
        : null;
      return [side, summary];
    }),
  ) as Record<(typeof LICENCE_SIDES)[number], ScanSummary | null>;

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Card>
        <CardHeader>
          <SectionLabel>Licence</SectionLabel>
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
          <SectionLabel>Licence photos</SectionLabel>
          <CardDescription>
            Kept in private storage, never shown on the page. Each opens for a few minutes only when
            you press Open, and every opening is recorded in the Log with who looked. Deleted
            automatically {monthsText(keptMonths)} after the Renter&rsquo;s last rental, or after
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
    </div>
  );
}
