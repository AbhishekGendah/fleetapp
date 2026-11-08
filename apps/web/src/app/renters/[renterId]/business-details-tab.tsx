import { formatAbn, renterShownName } from "@fleetapp/core";
import { Card, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";

import type { SignedInUser } from "../../../lib/require-user";
import { BUSINESS_RENTER_FIELD_LABELS } from "../../../lib/renters/renter-labels";
import type { RenterDetail } from "../../../lib/renters/renter-queries";
import { ArchiveCard, DetailsCardFrame, StatusCard, WhatWeHoldCard } from "./details-tab";

const NOT_GIVEN = "Not given";

function BusinessDetailsCard({ renter }: { renter: RenterDetail }) {
  const labels = BUSINESS_RENTER_FIELD_LABELS;
  const lines: readonly [string, string][] = [
    ["Kind", "Business"],
    [labels.fullName, renter.fullName],
    [labels.tradingName, renter.tradingName ?? NOT_GIVEN],
    [labels.abn, renter.abn ? formatAbn(renter.abn) : NOT_GIVEN],
    [labels.contactName, renter.contactName ?? NOT_GIVEN],
    [labels.phone, renter.phone ?? NOT_GIVEN],
    [labels.email, renter.email ?? NOT_GIVEN],
    [labels.businessAddress, renter.businessAddress ?? NOT_GIVEN],
    [
      labels.postalAddress,
      renter.postalAddress ?? (renter.businessAddress ? "Same as the business address" : NOT_GIVEN),
    ],
  ];
  return <DetailsCardFrame renter={renter} lines={lines} />;
}

/**
 * A business Renter's Details tab (7 Nov 2026 mockups): its details, Do not
 * rent, why it has no details link, everything held about it, and archive.
 */
export function BusinessDetailsTab({ renter, user }: { renter: RenterDetail; user: SignedInUser }) {
  const name = renterShownName(renter);
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <BusinessDetailsCard renter={renter} />
      <div className="flex flex-col gap-4">
        {renter.archivedAt ? null : (
          <StatusCard
            renter={renter}
            description={`Do not rent stops new bookings for ${name}. Its cars out and its drivers carry on; mark a driver separately if needed. No other Operator ever sees it.`}
          />
        )}
        <Card>
          <CardHeader>
            <SectionLabel>Details link</SectionLabel>
            <CardDescription>
              A business has no details link: you type its details. Each driver gets their own link
              from the Drivers tab.
            </CardDescription>
          </CardHeader>
        </Card>
        <WhatWeHoldCard
          renter={renter}
          description={`If ${name} asks what you hold about it, download it all as one zip file: its details, notes, its drivers' names on each rental, and all its rentals' money, signing records, damage and documents. Never a driver's licence or date of birth. Staff show as “the business”. The download is recorded in the Log.`}
        />
        <ArchiveCard
          renter={renter}
          user={user}
          archiveText={`Hides ${name} from your list. Nothing is deleted, and you can restore it. Not while it has a car out, a booking or current drivers.`}
        />
      </div>
    </div>
  );
}
