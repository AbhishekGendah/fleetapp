import { formatDateTimeInTimeZone } from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Badge } from "@fleetapp/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { XCircle } from "lucide-react";

import { appDb } from "../../../lib/app-db";
import { loadDetailsLink, type DetailsLinkStatus } from "../../../lib/renter-links/details-links";
import { loadWaitingSubmission } from "../../../lib/renter-links/submissions";
import type { SignedInUser } from "../../../lib/require-user";
import type { RenterDetail } from "../../../lib/renters/renter-queries";
import { DetailsLinkSender } from "./details-link-sender";
import { cancelDetailsLinkAction, sendDetailsLinkAction } from "./link-actions";

function LinkStatus({ link, timeZone }: { link: DetailsLinkStatus; timeZone: string }) {
  const sent = `Sent to ${link.sentToEmail} on ${formatDateTimeInTimeZone(link.sentAt, timeZone)}.`;
  if (link.isLocked) {
    return (
      <p className="text-sm">
        {sent} <Badge tone="danger">Locked</Badge> Too many wrong codes: send again for a new link.
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

/**
 * The Renter's details form link: send it, see where it went and until when,
 * send it again or cancel it. Needs an email on file for the codes.
 */
export async function DetailsLinkCard({
  renter,
  user,
}: {
  renter: RenterDetail;
  user: SignedInUser;
}) {
  const [link, waiting] = await Promise.all([
    loadDetailsLink(appDb, user.operatorId, renter.id, new Date()),
    loadWaitingSubmission(appDb, { operatorId: user.operatorId, renterId: renter.id }),
  ]);
  const isLive = link !== null && !link.isExpired && !link.isLocked;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details form</CardTitle>
        <CardDescription>
          Email the Renter a link to check their details and photograph their licence on their
          phone. The first time they open it on a phone, they type a code we email them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {waiting ? (
          <p className="text-sm">
            <Badge tone="attention">Waiting for your review</Badge> The Renter sent their details on{" "}
            {formatDateTimeInTimeZone(waiting.sentAt, user.operatorTimezone)}. Nothing on this page
            changes until you approve them.
            {/* TODO(Renter links part 4c): a Review button goes here. */}
          </p>
        ) : null}
        {link ? <LinkStatus link={link} timeZone={user.operatorTimezone} /> : null}
        {renter.email ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <DetailsLinkSender
              action={sendDetailsLinkAction.bind(null, renter.id)}
              hasLink={link !== null}
            />
            {isLive ? (
              <ActionButton
                action={cancelDetailsLinkAction.bind(null, renter.id)}
                label="Cancel link"
                pendingLabel="Cancelling…"
                variant="danger"
                icon={<XCircle aria-hidden />}
              />
            ) : null}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Add the Renter&rsquo;s email first (Edit, above): the link and its codes are sent there.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
