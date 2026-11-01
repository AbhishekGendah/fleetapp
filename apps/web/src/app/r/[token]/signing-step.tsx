import { CardDescription } from "@fleetapp/ui/card";
import { ContractReader } from "@fleetapp/ui/contract-reader";
import { FormSection } from "@fleetapp/ui/form-section";
import { headers } from "next/headers";

import { DetailLines } from "../../../components/detail-lines";
import { appDb } from "../../../lib/app-db";
import {
  loadSigningView,
  recordSigningEvidence,
  type SigningView,
} from "../../../lib/contracts/signing";
import type { LinkVisit } from "../../../lib/renter-links/link-visits";
import { requestMetaFrom } from "../../../lib/request-meta";
import { SigningForm } from "./signing-form";

/** Why the contract cannot be signed from this page. */
function closedMessage(
  status: Exclude<SigningView["status"], "ready">,
  operatorName: string,
): string {
  if (status === "signed") {
    return `Your contract is signed. A copy was emailed to you; ask ${operatorName} if you need it again.`;
  }
  if (status === "changed") {
    return `The contract has changed since this link was sent, so it can no longer be signed here. Ask ${operatorName} to send you the new version.`;
  }
  return `This contract can no longer be signed. Ask ${operatorName} if you think that is wrong.`;
}

/**
 * A signing link once its phone has passed the code: the Renter checks their
 * details, reads the whole contract, agrees and signs. Opening the contract
 * is recorded as evidence, with the fingerprint of the text shown.
 */
export async function SigningStep({ token, visit }: { token: string; visit: LinkVisit }) {
  const view = await loadSigningView(appDb, visit);
  if (view.status !== "ready") {
    return (
      <CardDescription role="status">
        {closedMessage(view.status, visit.operatorName)}
      </CardDescription>
    );
  }
  await recordSigningEvidence(appDb, visit, "contract_viewed", requestMetaFrom(await headers()), {
    contractFingerprint: view.fingerprint,
  });
  return (
    <div className="flex flex-col gap-6">
      <CardDescription>
        {visit.operatorName} has sent your contract for {view.rentalSummary}. Check your details,
        read the whole contract, then sign at the bottom.
      </CardDescription>
      <FormSection title="1. Check your details">
        <DetailLines lines={view.details} />
        <p className="text-muted-foreground text-sm">
          Something not right? Don’t sign: contact {visit.operatorName} to fix it first.
        </p>
      </FormSection>
      <FormSection title="2. Read the contract">
        <ContractReader content={view.document} label="Your rental contract" />
      </FormSection>
      <SigningForm
        token={token}
        renterFullName={view.renterFullName}
        contractFingerprint={view.fingerprint}
        operatorName={visit.operatorName}
      />
    </div>
  );
}
