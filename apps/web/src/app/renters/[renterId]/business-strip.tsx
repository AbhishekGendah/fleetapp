import { formatAbn, renterShownName } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { RecordStrip } from "@fleetapp/ui/record-strip";
import { Pencil } from "lucide-react";
import Link from "next/link";

import { editRenterPath, RENTERS_PATH } from "../../../lib/paths";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import { businessSinceFact, carsOutFact } from "../../../lib/renters/business-page-facts";
import { callHref, emailHref, textHref } from "../../../lib/renters/contact-links";
import { renterOwingFact } from "../../../lib/renters/renter-page-facts";
import type { RenterDetail } from "../../../lib/renters/renter-queries";
import { RenterBadges, RenterKindLabels } from "../renter-list";
import type { RenterPageData } from "./renter-page-data";
import { DottedLine, STRIP_LINK_CLASSES } from "./renter-strip";

/** Its legal name (when it trades by another) and ABN, grouped as written. */
function legalLine(renter: RenterDetail): React.ReactNode[] {
  return [
    renter.tradingName ? <span key="legal">{renter.fullName}</span> : null,
    renter.abn ? <span key="abn">ABN {formatAbn(renter.abn)}</span> : null,
  ].filter((part) => part !== null);
}

/** "Contact Dana Wells", then Call, Text and Email, each opening the phone's own app. */
function ContactLinks({ renter }: { renter: RenterDetail }) {
  const links = [
    renter.phone ? (
      <a key="call" href={callHref(renter.phone)} className={STRIP_LINK_CLASSES}>
        Call
      </a>
    ) : null,
    renter.phone ? (
      <a key="text" href={textHref(renter.phone)} className={STRIP_LINK_CLASSES}>
        Text
      </a>
    ) : null,
    renter.email ? (
      <a key="email" href={emailHref(renter.email)} className={STRIP_LINK_CLASSES}>
        Email
      </a>
    ) : null,
  ].filter((part) => part !== null);
  return (
    <span className="flex flex-wrap items-center gap-x-3">
      {renter.contactName ? <span>Contact {renter.contactName}</span> : null}
      {links}
    </span>
  );
}

/**
 * The navy strip at the top of a business Renter's page (7 Nov 2026
 * mockups): its trading name, legal name and ABN, its contact with Call,
 * Text and Email; what it owes across its cars (each rental's ledger added
 * up, rule 11), how many cars it has out and since when it has rented. No
 * New rental yet: renting to a business comes with its driver picker and
 * contract (plan slice 3).
 */
export function BusinessStrip(props: {
  renter: RenterDetail;
  data: RenterPageData;
  driverCount: number;
  clock: RentalClock;
}) {
  const { renter, data } = props;
  return (
    <RecordStrip
      backHref={RENTERS_PATH}
      backLabel="Renters"
      title={renterShownName(renter)}
      subtitle={
        <span className="flex flex-col gap-1">
          <DottedLine parts={legalLine(renter)} />
          <ContactLinks renter={renter} />
        </span>
      }
      badges={
        <>
          <RenterKindLabels labels={data.kindLabels} />
          <RenterBadges badges={data.badges} />
        </>
      }
      facts={[
        { ...renterOwingFact(data.ledger, data.overdue, data.today), label: "Owing across cars" },
        carsOutFact(data.rentalsUnderWay, props.clock),
        businessSinceFact(
          renter.createdAt,
          { rentals: data.rentalCount, drivers: props.driverCount },
          props.clock.timeZone,
        ),
      ]}
      actions={
        renter.archivedAt ? undefined : (
          <Button asChild variant="inverse-outline">
            <Link href={editRenterPath(renter.id)}>
              <Pencil aria-hidden />
              Edit
            </Link>
          </Button>
        )
      }
    />
  );
}
