import {
  ageOn,
  formatCalendarDate,
  formatDateTimeInTimeZone,
  todayInTimeZone,
} from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";
import { Archive, ArchiveRestore, Download, Pencil } from "lucide-react";
import Link from "next/link";

import { DetailLines } from "../../../components/detail-lines";
import { editRenterPath, renterEverythingHeldPath } from "../../../lib/paths";
import type { SignedInUser } from "../../../lib/require-user";
import { renterStatusFormValues } from "../../../lib/renters/renter-input";
import { RENTER_FIELD_LABELS } from "../../../lib/renters/renter-labels";
import type { RenterDetail } from "../../../lib/renters/renter-queries";
import { changeRenterStatusAction, setRenterArchivedAction } from "./actions";
import { RenterStatusForm } from "./status-form";

const NOT_GIVEN = "Not given";

function dateOfBirthText(dateOfBirth: string | null, today: string): string {
  return dateOfBirth
    ? `${formatCalendarDate(dateOfBirth)} (age ${ageOn(dateOfBirth, today)})`
    : NOT_GIVEN;
}

function DetailsCard({ renter, today }: { renter: RenterDetail; today: string }) {
  const lines: readonly [string, string][] = [
    [RENTER_FIELD_LABELS.fullName, renter.fullName],
    [RENTER_FIELD_LABELS.preferredName, renter.preferredName ?? NOT_GIVEN],
    [RENTER_FIELD_LABELS.phone, renter.phone ?? NOT_GIVEN],
    [RENTER_FIELD_LABELS.email, renter.email ?? NOT_GIVEN],
    [RENTER_FIELD_LABELS.dateOfBirth, dateOfBirthText(renter.dateOfBirth, today)],
    [RENTER_FIELD_LABELS.residentialAddress, renter.residentialAddress ?? NOT_GIVEN],
    [
      RENTER_FIELD_LABELS.postalAddress,
      renter.postalAddress ?? (renter.residentialAddress ? "Same as home" : NOT_GIVEN),
    ],
    [
      RENTER_FIELD_LABELS.emergencyContactName,
      [
        renter.emergencyContactName,
        renter.emergencyContactRelationship && `(${renter.emergencyContactRelationship})`,
        renter.emergencyContactPhone,
      ]
        .filter(Boolean)
        .join(" ") || NOT_GIVEN,
    ],
  ];
  return <DetailsCardFrame renter={renter} lines={lines} />;
}

/** The Details card, person or business: its lines, with Edit details unless archived. */
export function DetailsCardFrame(props: {
  renter: RenterDetail;
  lines: readonly (readonly [string, string])[];
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <SectionLabel>Details</SectionLabel>
        {props.renter.archivedAt ? null : (
          <Button asChild variant="outline">
            <Link href={editRenterPath(props.renter.id)}>
              <Pencil aria-hidden />
              Edit details
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <DetailLines lines={props.lines} />
      </CardContent>
    </Card>
  );
}

/** Active, or Do not rent with a reason: `description` says what it stops for this kind. */
export function StatusCard({ renter, description }: { renter: RenterDetail; description: string }) {
  return (
    <Card>
      <CardHeader>
        <SectionLabel>Status</SectionLabel>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <RenterStatusForm
          initialValues={renterStatusFormValues(renter)}
          action={changeRenterStatusAction.bind(null, renter.id)}
        />
      </CardContent>
    </Card>
  );
}

/** The one zip of everything held, for a Renter who asks (APP 12): `description` says what is in it. */
export function WhatWeHoldCard({
  renter,
  description,
}: {
  renter: RenterDetail;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <SectionLabel>What we hold</SectionLabel>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <a href={renterEverythingHeldPath(renter.id)} download>
            <Download aria-hidden />
            Download everything we hold
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

/** Archive or restore; or, seven years on, that their details were removed. */
export function ArchiveCard(props: {
  renter: RenterDetail;
  user: SignedInUser;
  /** What archiving does, and what stands in its way, for this kind of Renter. */
  archiveText: string;
}) {
  const { renter, user } = props;
  const isArchived = renter.archivedAt !== null;
  if (renter.retiredAt) {
    return (
      <Card>
        <CardHeader>
          <SectionLabel>Details removed</SectionLabel>
          <CardDescription>
            Seven years after their last rental, this Renter&rsquo;s personal details, documents and
            photos were removed on{" "}
            {formatDateTimeInTimeZone(renter.retiredAt, user.operatorTimezone)}. Their money records
            stay. They can&rsquo;t be restored: add them again if they come back.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <SectionLabel>{isArchived ? "Archived" : "Archive"}</SectionLabel>
        <CardDescription>
          {isArchived
            ? "Hidden from your list and read-only. Restore to change anything."
            : props.archiveText}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionButton
          action={setRenterArchivedAction.bind(null, renter.id, !isArchived)}
          label={isArchived ? "Restore this Renter" : "Archive this Renter"}
          pendingLabel={isArchived ? "Restoring…" : "Archiving…"}
          icon={isArchived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
        />
      </CardContent>
    </Card>
  );
}

export function DetailsTab({ renter, user }: { renter: RenterDetail; user: SignedInUser }) {
  const isArchived = renter.archivedAt !== null;
  const today = todayInTimeZone(new Date(), user.operatorTimezone);
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <DetailsCard renter={renter} today={today} />
      <div className="flex flex-col gap-4">
        {isArchived ? null : (
          <StatusCard
            renter={renter}
            description="Do not rent stays with your business: no other Operator ever sees it. On a driver, they can't be named on any business's car either."
          />
        )}
        <WhatWeHoldCard
          renter={renter}
          description="If the Renter asks what you hold about them, download it all as one zip file: a spreadsheet of their details, licence, notes, rentals, money, signing records, links, damage and Log, with their signed documents, reports, invoices and licence scans. For a driver, the cars they drove for a business too, never that business's money. Staff show as “the business”. The download is recorded in the Log."
        />
        <ArchiveCard
          renter={renter}
          user={user}
          archiveText="Hides the Renter from your list. Nothing is deleted, and you can restore them. Not while they have a car booked or out, or drive for a business."
        />
      </div>
    </div>
  );
}
