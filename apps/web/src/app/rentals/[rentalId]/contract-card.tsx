import { isContractSignable, mergeFieldLabel, missingMergeFields } from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";
import { FileText, XCircle } from "lucide-react";
import Link from "next/link";

import { RenterLinkSender } from "../../../components/renter-link-sender";
import { RenterLinkStatus } from "../../../components/renter-link-status";
import { appDb } from "../../../lib/app-db";
import { loadContractData } from "../../../lib/contracts/contract-data";
import { loadSigningStatus, type SigningStatus } from "../../../lib/contracts/signing-links";
import { withPaperCheck } from "../../../lib/contracts/signing";
import { loadDefaultTemplate } from "../../../lib/contracts/templates";
import { CONTRACTS_PATH, rentalContractPreviewPath } from "../../../lib/paths";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import { NoBusinessEmailWarning } from "../../../components/no-business-email-warning";
import type { SignedInUser } from "../../../lib/require-user";
import { cancelSigningLinkAction, sendSigningLinkAction } from "./signing-actions";

function NoTemplateCard() {
  return (
    <Card>
      <CardHeader>
        <SectionLabel>Contract</SectionLabel>
        <CardDescription>
          You have no contract template yet. Write yours once and it is filled in for each rental.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href={CONTRACTS_PATH}>Set up your contract</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** Sending the contract to sign, and the link already sent, once nothing is missing. */
function SigningControls({
  rentalId,
  link,
  timeZone,
}: {
  rentalId: string;
  link: SigningStatus["link"];
  timeZone: string;
}) {
  const isLive = link !== null && !link.isExpired && !link.isLocked;
  return (
    <>
      {link ? <RenterLinkStatus link={link} timeZone={timeZone} /> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <RenterLinkSender
          action={sendSigningLinkAction.bind(null, rentalId)}
          hasLink={link !== null}
          sendLabel="Send for signing"
          urlFieldId="signing-link"
        />
        {isLive ? (
          <ActionButton
            action={cancelSigningLinkAction.bind(null, rentalId)}
            label="Cancel link"
            pendingLabel="Cancelling…"
            variant="danger"
            icon={<XCircle aria-hidden />}
          />
        ) : null}
      </div>
    </>
  );
}

/**
 * The rental's contract before it is signed (the signed PDF is in Signed papers): a preview
 * from the business's default template, which details it still needs, and
 * sending it to the Renter to sign on their phone.
 */
export async function ContractCard({
  rental,
  user,
  clock,
}: {
  rental: RentalDetail;
  user: SignedInUser;
  clock: RentalClock;
}) {
  const signing = await loadSigningStatus(appDb, user.operatorId, rental.id, clock.now);
  // Once signed, the contract is in the Signed papers list.
  if (signing.signed || !isContractSignable(rental.status)) {
    return null;
  }
  const template = await loadDefaultTemplate(appDb, user.operatorId, "contract");
  if (!template) {
    return <NoTemplateCard />;
  }
  const data = await loadContractData(appDb, user.operatorId, rental.id, clock);
  const missing = data ? missingMergeFields(template.content, data) : [];
  return (
    <Card>
      <CardHeader>
        <SectionLabel>Contract</SectionLabel>
        <CardDescription>
          From your template “{template.name}” (version {template.latestVersion}), filled in with
          this rental’s details. The Renter reads and signs it on their phone; the first time they
          open the link on a phone, they type a code we email them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {missing.length > 0 ? (
          <div className="text-attention text-sm" role="status">
            <p className="font-medium">
              Not on file yet. Fill these in before sending it for signing:
            </p>
            <ul className="list-disc pl-5">
              {missing.map((key) => (
                <li key={key}>{mergeFieldLabel(key)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <Button asChild variant="outline" className="w-full sm:w-auto sm:self-start">
          <a href={rentalContractPreviewPath(rental.id)} target="_blank" rel="noopener">
            <FileText aria-hidden />
            Preview contract
          </a>
        </Button>
        {missing.length === 0 ? <NoBusinessEmailWarning user={user} /> : null}
        {missing.length === 0 ? (
          <SigningControls
            rentalId={rental.id}
            link={await withPaperCheck(appDb, user.operatorId, {
              link: signing.link,
              sentPaper: signing.sentPaper,
              rentalId: rental.id,
              change: null,
              handedOverAt: rental.handedOverAt,
              timeZone: user.operatorTimezone,
            })}
            timeZone={user.operatorTimezone}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
