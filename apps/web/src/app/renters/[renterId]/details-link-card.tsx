import { formatDateTimeInTimeZone } from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Card, CardContent, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";
import { Button } from "@fleetapp/ui/button";
import { ClipboardCheck, XCircle } from "lucide-react";
import Link from "next/link";

import { appDb } from "../../../lib/app-db";
import { RenterLinkSender } from "../../../components/renter-link-sender";
import { RenterLinkStatus } from "../../../components/renter-link-status";
import { loadDetailsLink } from "../../../lib/renter-links/details-links";
import { renterReviewPath } from "../../../lib/paths";
import { loadWaitingSubmission } from "../../../lib/renter-links/submissions";
import { NoBusinessEmailWarning } from "../../../components/no-business-email-warning";
import type { SignedInUser } from "../../../lib/require-user";
import type { RenterDetail } from "../../../lib/renters/renter-queries";
import { WaitingReviewBadge } from "../renter-status-badge";
import { cancelDetailsLinkAction, sendDetailsLinkAction } from "./link-actions";

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
        <SectionLabel>Details form</SectionLabel>
        <CardDescription>
          Email the Renter a link to check their details and photograph their licence on their
          phone. The first time they open it on a phone, they type a code we email them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {waiting ? (
          <div className="bg-attention-soft flex flex-col gap-3 rounded-lg p-3">
            <p className="text-sm">
              <WaitingReviewBadge /> The Renter sent their details on{" "}
              {formatDateTimeInTimeZone(waiting.sentAt, user.operatorTimezone)}. Nothing on this
              page changes until you approve them.
            </p>
            <Button asChild className="w-full sm:w-auto sm:self-start">
              <Link href={renterReviewPath(renter.id)}>
                <ClipboardCheck aria-hidden />
                Review what they sent
              </Link>
            </Button>
          </div>
        ) : null}
        {link ? <RenterLinkStatus link={link} timeZone={user.operatorTimezone} /> : null}
        {renter.email ? <NoBusinessEmailWarning user={user} /> : null}
        {renter.email ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <RenterLinkSender
              action={sendDetailsLinkAction.bind(null, renter.id)}
              hasLink={link !== null}
              sendLabel="Send details form"
              urlFieldId="details-link"
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
