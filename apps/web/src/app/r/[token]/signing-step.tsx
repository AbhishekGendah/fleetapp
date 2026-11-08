import { describeErrorForLog } from "@fleetapp/core";
import { CardDescription } from "@fleetapp/ui/card";
import { ContractReader } from "@fleetapp/ui/contract-reader";
import { FormSection } from "@fleetapp/ui/form-section";
import { headers } from "next/headers";

import { DetailLines } from "../../../components/detail-lines";
import { appDb } from "../../../lib/app-db";
import {
  loadSigningView,
  recordSigningEvidence,
  type SignedDocumentKind,
  type SigningView,
} from "../../../lib/contracts/signing";
import type { LinkVisit } from "../../../lib/renter-links/link-visits";
import { requestMetaFrom } from "../../../lib/request-meta";
import { SigningForm } from "./signing-form";

/** How the page names what is being signed. */
const DOCUMENT_NAMES: Readonly<Record<SignedDocumentKind, string>> = {
  contract: "contract",
  change_of_terms: "change of terms",
};

/** Why it cannot be signed from this page. */
function closedMessage(
  status: Exclude<SigningView["status"], "ready">,
  operatorName: string,
  name: string,
): string {
  if (status === "signed") {
    return `This ${name} is signed. Ask ${operatorName} if you need a copy.`;
  }
  if (status === "changed") {
    return `The ${name} has changed since this link was sent, so it can no longer be signed here. Ask ${operatorName} to send you the new version.`;
  }
  return `This ${name} can no longer be signed. Ask ${operatorName} if you think that is wrong.`;
}

/** What was sent, in the signer's words: a business's paper is the business's, not theirs. */
function introFor(view: Extract<SigningView, { status: "ready" }>): string {
  if (view.authority) {
    return view.kind === "contract"
      ? `the business rental contract of ${view.authority.legalName}`
      : `a change to the rental of ${view.authority.legalName}`;
  }
  return view.kind === "contract" ? "your contract" : "a change to your rental";
}

const NOT_RECORDED_MESSAGE =
  "Something went wrong opening this. Please try again in a moment by reloading the page.";

/**
 * Records that the Renter opened the document. It can't be signed without
 * that record, so a failure stops the page calmly; only the error's type is
 * logged, never the Renter's internet address in it (review A3-10).
 */
async function isOpeningRecorded(visit: LinkVisit, fingerprint: string): Promise<boolean> {
  try {
    const meta = requestMetaFrom(await headers());
    await recordSigningEvidence(appDb, visit, "contract_viewed", meta, {
      contractFingerprint: fingerprint,
    });
    return true;
  } catch (error) {
    console.error("Recording that a contract was opened failed", describeErrorForLog(error));
    return false;
  }
}

/**
 * A signing link once its phone has passed the code: the Renter checks their
 * details, reads the whole contract, agrees and signs. Opening the contract
 * is recorded as evidence, with the fingerprint of the text shown.
 */
export async function SigningStep({ token, visit }: { token: string; visit: LinkVisit }) {
  const view = await loadSigningView(appDb, visit);
  if (view.status !== "ready") {
    const name = visit.signing?.rentalChangeId ? DOCUMENT_NAMES.change_of_terms : "contract";
    return (
      <CardDescription role="status">
        {closedMessage(view.status, visit.operatorName, name)}
      </CardDescription>
    );
  }
  const name = DOCUMENT_NAMES[view.kind];
  if (!(await isOpeningRecorded(visit, view.fingerprint))) {
    return <CardDescription role="alert">{NOT_RECORDED_MESSAGE}</CardDescription>;
  }
  return (
    <div className="flex flex-col gap-6">
      <CardDescription>
        {visit.operatorName} has sent {introFor(view)} for {view.rentalSummary}. Check{" "}
        {view.authority ? "the" : "your"} details, read the whole {name}, then sign at the bottom.
      </CardDescription>
      <FormSection title={view.authority ? "1. Check the details" : "1. Check your details"}>
        <DetailLines lines={view.details} />
        <p className="text-muted-foreground text-sm">
          Something not right? Don’t sign: contact {visit.operatorName} to fix it first.
        </p>
      </FormSection>
      <FormSection title={`2. Read the ${name}`}>
        <ContractReader
          content={view.document}
          label={
            view.kind === "contract"
              ? view.authority
                ? "The business rental contract"
                : "Your rental contract"
              : "The change of terms"
          }
        />
      </FormSection>
      <SigningForm
        token={token}
        renterFullName={view.renterFullName}
        authority={
          view.authority
            ? { legalName: view.authority.legalName, contactName: view.contactName }
            : null
        }
        contractFingerprint={view.fingerprint}
        documentName={name}
        operatorName={visit.operatorName}
      />
    </div>
  );
}
