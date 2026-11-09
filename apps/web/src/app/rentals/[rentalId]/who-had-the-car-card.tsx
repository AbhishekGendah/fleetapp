import { formatDateTimeInTimeZone } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { InlineRecordLink } from "@fleetapp/ui/row-link";
import Link from "next/link";

import { SectionCard } from "../../../components/section-card";
import { appDb } from "../../../lib/app-db";
import { listRentalPossessions } from "../../../lib/handover/possession-records";
import { renterPath } from "../../../lib/paths";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { SignedInUser } from "../../../lib/require-user";

/**
 * Who had a business's car and when (mockup 6), from the signed handovers,
 * returns, swaps and driver changes: what fines are matched to (rule 15).
 * A person's own rental is always theirs, so it isn't shown there.
 */
export async function WhoHadTheCarCard(props: { rental: RentalDetail; user: SignedInUser }) {
  const { rental, user } = props;
  if (rental.renterKind !== "organisation" || !rental.handedOverAt) {
    return null;
  }
  const held = await listRentalPossessions(appDb, user.operatorId, rental.id);
  const isOneCar = new Set(held.map((possession) => possession.carRego)).size === 1;
  const onClock = (moment: Date) => formatDateTimeInTimeZone(moment, user.operatorTimezone);
  return (
    <SectionCard heading="Who had the car">
      <p className="text-muted-foreground pb-2 text-sm">
        From the signed handovers, returns and driver changes. Fines are matched to these times.
      </p>
      <ul aria-label="Who had the car">
        {[...held].reverse().map((possession) => (
          <li
            key={possession.id}
            className="flex min-h-14 items-center justify-between gap-3 border-t py-2"
          >
            <span className="flex min-w-0 flex-col">
              <InlineRecordLink asChild isLinkOnPhones>
                <Link href={renterPath(possession.driverId)}>{possession.driverName}</Link>
              </InlineRecordLink>
              <span className="text-muted-foreground text-sm">
                {isOneCar ? "" : `${possession.carRego} · `}
                {onClock(possession.startedAt)} to{" "}
                {possession.endedAt ? onClock(possession.endedAt) : "now"}
              </span>
            </span>
            {possession.endedAt ? null : <Badge tone="out">Has it</Badge>}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
