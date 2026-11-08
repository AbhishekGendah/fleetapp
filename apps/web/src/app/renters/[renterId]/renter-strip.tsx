import { renterFirstName } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { RecordStrip } from "@fleetapp/ui/record-strip";
import { InlineRecordLink } from "@fleetapp/ui/row-link";
import { Pencil, Plus } from "lucide-react";
import Link from "next/link";

import { carPath, editRenterPath, newRentalPath, RENTERS_PATH } from "../../../lib/paths";
import { callHref, emailHref } from "../../../lib/renters/contact-links";
import {
  licenceFact,
  rentingFact,
  renterOwingFact,
  withYouSinceFact,
} from "../../../lib/renters/renter-page-facts";
import type { RenterDetail } from "../../../lib/renters/renter-queries";
import { RenterBadges, RenterKindLabels } from "../renter-list";
import type { RenterPageData } from "./renter-page-data";

export const STRIP_LINK_CLASSES =
  "text-primary-foreground hover:text-on-primary-label focus-visible:ring-primary-foreground inline-flex min-h-11 items-center rounded-sm font-bold outline-none focus-visible:ring-2";

/** Their phone and email, each opening the phone's own app; and the name they go by. */
function ContactLine({ renter }: { renter: RenterDetail }) {
  const parts = [
    renter.preferredName && renter.preferredName !== renter.fullName ? (
      <span key="goes-by">Goes by {renter.preferredName}</span>
    ) : null,
    renter.phone ? (
      <a key="phone" href={callHref(renter.phone)} className={STRIP_LINK_CLASSES}>
        {renter.phone}
      </a>
    ) : null,
    renter.email ? (
      <a key="email" href={emailHref(renter.email)} className={`${STRIP_LINK_CLASSES} break-all`}>
        {renter.email}
      </a>
    ) : null,
  ].filter((part) => part !== null);
  return <DottedLine parts={parts} />;
}

/** Bits of the strip's second line, a dot between each. */
export function DottedLine({ parts }: { parts: readonly React.ReactNode[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      {parts.flatMap((part, index) =>
        index === 0
          ? [part]
          : [
              <span key={`dot-${index}`} aria-hidden>
                ·
              </span>,
              part,
            ],
      )}
    </span>
  );
}

/** A Renter's strip's Edit and New rental (a person's or a business's); none once archived. */
export function RenterStripActions(props: {
  renter: Pick<RenterDetail, "id" | "archivedAt">;
  newRentalLabel: string;
}) {
  if (props.renter.archivedAt) {
    return null;
  }
  return (
    <>
      <Button asChild variant="inverse-outline">
        <Link href={editRenterPath(props.renter.id)}>
          <Pencil aria-hidden />
          Edit
        </Link>
      </Button>
      <Button asChild variant="inverse">
        <Link href={newRentalPath({ renterId: props.renter.id })}>
          <Plus aria-hidden />
          {props.newRentalLabel}
        </Link>
      </Button>
    </>
  );
}

/**
 * The navy strip at the top of one Renter's page (the navy strip rule): their
 * name, phone and email, their labels, and what they owe, the car they have
 * (its rego opens it), their licence (never its number) and since when they
 * have rented; with Edit and New rental.
 */
export function RenterStrip(props: {
  renter: RenterDetail;
  data: RenterPageData;
  timeZone: string;
}) {
  const { renter, data } = props;
  const renting = rentingFact(data.renting);
  const car = data.renting.rental;
  const firstName = renterFirstName(renter.fullName, renter.preferredName);
  return (
    <RecordStrip
      backHref={RENTERS_PATH}
      backLabel="Renters"
      title={renter.fullName}
      subtitle={<ContactLine renter={renter} />}
      badges={
        <>
          <RenterKindLabels labels={data.kindLabels} />
          <RenterBadges badges={data.badges} />
        </>
      }
      facts={[
        data.paidByText
          ? { ...renterOwingFact(data.ledger, data.overdue, data.today), note: data.paidByText }
          : renterOwingFact(data.ledger, data.overdue, data.today),
        {
          label: renting.label,
          value: car ? (
            <InlineRecordLink asChild tone="onPrimary" isLinkOnPhones>
              <Link href={carPath(car.vehicleId)}>{car.rego}</Link>
            </InlineRecordLink>
          ) : (
            "None"
          ),
          note: renting.note,
        },
        licenceFact({ ...renter, status: data.licenceStatus }),
        withYouSinceFact(renter.createdAt, data.rentalCount, props.timeZone),
      ]}
      actions={
        <RenterStripActions renter={renter} newRentalLabel={`New rental for ${firstName}`} />
      }
    />
  );
}
