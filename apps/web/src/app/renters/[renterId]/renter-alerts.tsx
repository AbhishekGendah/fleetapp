import {
  DETAIL_NEEDED_LABELS,
  detailsStillNeeded,
  type DetailNeededBeforeRenting,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";
import { IdCard, Pencil } from "lucide-react";
import Link from "next/link";

import { editRenterPath, renterPath } from "../../../lib/paths";
import type { RenterDetail, SharedContact } from "../../../lib/renters/renter-queries";
import { RENTER_TAB_LINKS } from "./renter-tabs";

const LICENCE_DETAILS: readonly DetailNeededBeforeRenting[] = [
  "licence",
  "currentLicence",
  "licenceScans",
];

export function StillNeededCard(props: {
  renter: RenterDetail;
  isEditable: boolean;
  hasBothLicenceScans: boolean;
  today: string;
}) {
  const { renter, isEditable } = props;
  const missing = detailsStillNeeded({
    dateOfBirth: renter.dateOfBirth,
    residentialAddress: renter.residentialAddress,
    licenceExpiresOn: renter.licenceExpiresOn,
    hasBothLicenceScans: props.hasBothLicenceScans,
    today: props.today,
  });
  const isLicenceMissing = missing.some((detail) => LICENCE_DETAILS.includes(detail));
  const isDetailMissing = missing.some((detail) => !LICENCE_DETAILS.includes(detail));
  if (missing.length === 0) {
    return null;
  }
  return (
    <Card className="border-attention/40">
      <CardHeader>
        <SectionLabel>Still needed before renting</SectionLabel>
        <CardDescription>Rentals will not start until these are on file.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="list-disc pl-5 text-sm">
          {missing.map((detail) => (
            <li key={detail}>{DETAIL_NEEDED_LABELS[detail]}</li>
          ))}
        </ul>
        {isEditable ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            {isLicenceMissing ? (
              <Button asChild className="w-full sm:w-auto">
                <Link href={RENTER_TAB_LINKS.href(renter.id, "licence")}>
                  <IdCard aria-hidden />
                  Go to the licence
                </Link>
              </Button>
            ) : null}
            {isDetailMissing ? (
              <Button
                asChild
                variant={isLicenceMissing ? "outline" : "default"}
                className="w-full sm:w-auto"
              >
                <Link href={editRenterPath(renter.id)}>
                  <Pencil aria-hidden />
                  Add the details
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function sharedWhat(contact: SharedContact): string {
  return [contact.sharesPhone ? "phone" : null, contact.sharesEmail ? "email" : null]
    .filter(Boolean)
    .join(" and ");
}

/** Maybe the same person entered twice, maybe family: a note, never a block. */
export function SharedContactNote({ contacts }: { contacts: readonly SharedContact[] }) {
  if (contacts.length === 0) {
    return null;
  }
  return (
    <Card className="border-attention/40">
      <CardContent className="flex flex-col gap-2 pt-4 text-sm sm:pt-6">
        <p className="text-attention font-medium">
          Another Renter has the same phone or email. Check it is not the same person entered twice.
        </p>
        <ul className="flex flex-col gap-1">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <Link
                href={renterPath(contact.id)}
                className="text-teal hover:text-primary inline-flex min-h-11 items-center font-semibold"
              >
                {contact.fullName}
                {contact.isArchived ? " (archived)" : ""}: same {sharedWhat(contact)} →
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
