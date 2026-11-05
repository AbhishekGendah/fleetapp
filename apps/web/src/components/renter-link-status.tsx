import { formatDateTimeInTimeZone } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";

import type { RenterLinkInPlay } from "../lib/renter-links/details-links";

/** Where a Renter link went and when, and whether it still works. */
export function RenterLinkStatus({ link, timeZone }: { link: RenterLinkInPlay; timeZone: string }) {
  const sent = `Sent to ${link.sentToEmail} on ${formatDateTimeInTimeZone(link.sentAt, timeZone)}.`;
  if (link.isLocked) {
    return (
      <p className="text-sm">
        {sent} <Badge tone="danger">Locked</Badge> Too many wrong codes: send again for a new link.
      </p>
    );
  }
  if (link.isPaperChanged) {
    return (
      <p className="text-sm">
        {sent} <Badge tone="attention">Changed since it was sent</Badge> The Renter can&apos;t sign
        this link: send it again.
      </p>
    );
  }
  if (link.isExpired) {
    return (
      <p className="text-sm">
        {sent} <Badge>Expired</Badge> Send again for a new link.
      </p>
    );
  }
  return (
    <p className="text-sm">
      {sent} Works until {formatDateTimeInTimeZone(link.expiresAt, timeZone)}.
    </p>
  );
}
