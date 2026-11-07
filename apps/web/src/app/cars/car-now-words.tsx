import { InlineRecordLink } from "@fleetapp/ui/row-link";
import Link from "next/link";

import { renterPath } from "../../lib/paths";
import type { CarNow } from "../../lib/vehicles/car-now";

function RenterLink(props: { renterId: string; name: string; isOnStrip: boolean }) {
  return (
    <InlineRecordLink
      asChild
      tone={props.isOnStrip ? "onPrimary" : "teal"}
      isLinkOnPhones={props.isOnStrip}
    >
      <Link href={renterPath(props.renterId)}>{props.name}</Link>
    </InlineRecordLink>
  );
}

/**
 * What a car is doing now, the Renter's name opening them: the Cars list's
 * Now column, and on the car's own strip (`isOnStrip`) after its status,
 * "with Jamie Park, since Fri 6 Nov".
 */
export function CarNowWords({
  now,
  isOnStrip = false,
}: {
  now: CarNow | null;
  isOnStrip?: boolean;
}) {
  if (!now) {
    return null;
  }
  switch (now.kind) {
    case "with_renter":
      return (
        <span>
          {isOnStrip ? "with " : null}
          <RenterLink
            renterId={now.rental.renterId}
            name={now.rental.renterName}
            isOnStrip={isOnStrip}
          />
          , {now.words}
        </span>
      );
    case "booked":
      return (
        <span>
          Booked by{" "}
          <RenterLink
            renterId={now.rental.renterId}
            name={now.rental.renterName}
            isOnStrip={isOnStrip}
          />
          , {now.day}
        </span>
      );
    case "idle_then_booked":
      return (
        <span>
          {now.idle} · booked by{" "}
          <RenterLink
            renterId={now.rental.renterId}
            name={now.rental.renterName}
            isOnStrip={isOnStrip}
          />
          , {now.day}
        </span>
      );
    case "plain":
      return <span>{now.words}</span>;
  }
}
