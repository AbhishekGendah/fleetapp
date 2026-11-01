import {
  decodeDrawnSignature,
  describeDevice,
  describeErrorForLog,
  formatDateTimeInTimeZone,
  SIGNATURE_METHOD_LABELS,
  SIGNING_CONSENT_TEXT,
  SIGNING_EVIDENCE_STEP_LABELS,
  signContractInputSchema,
  type ContractData,
  type SignContractInput,
  type SigningEvidenceStep,
  type TemplateDocument,
} from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  issuedDocuments,
  renterLinks,
  rentals,
  signingEvidence,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { renderContractSignedEmail, type EmailSender } from "@fleetapp/email";
import { and, asc, eq, isNull, ne } from "drizzle-orm";

import type { FileDependencies } from "../files/stored-files";
import type { LinkVisit } from "../renter-links/link-visits";
import type { RequestMeta } from "../request-meta";
import { loadBusinessDetails } from "../settings/business-details";
import { loadPdfBranding } from "./contract-pdf";
import { renderDocumentPdf, type PdfSignature, type PdfSigningRecord } from "./document-pdf";
import { fillContract } from "./filled-contract";
import { issueDocument } from "./issued-documents";
import { rentalSummaryText } from "./signing-links";
import { loadTemplateVersion } from "./templates";

/** Until the car is handed over, the contract can still be signed. */
const SIGNABLE_STATUSES = new Set(["draft", "booked"]);
const CONTRACT_TITLE = "Rental contract";

/** What the Renter checks before reading: label and value, in their own words. */
export type DetailRow = readonly [label: string, value: string];

export type SigningView =
  | {
      status: "ready";
      document: TemplateDocument;
      fingerprint: string;
      renterFullName: string;
      details: DetailRow[];
      rentalSummary: string;
    }
  | { status: "signed" | "changed" | "not_signable" };

function detailRows(data: ContractData): DetailRow[] {
  const rows: [string, string | null][] = [
    ["Name", data.renterFullName],
    ["Date of birth", data.renterDateOfBirth],
    ["Home address", data.renterAddress],
    ["Phone", data.renterPhone],
    ["Email", data.renterEmail],
    ["Licence", data.renterLicenceNumber],
    ["Car", [data.carRego, data.carMakeModel].filter(Boolean).join(" · ")],
    ["Starts", data.rentalStart],
    ["Ends", data.rentalEnd],
    ["Weekly rate", data.weeklyRate],
    ["Bond", data.bond],
  ];
  return rows.flatMap(([label, value]) => (value ? [[label, value] as const] : []));
}

/** Whether the rental already has a signed contract, other than `exceptDocumentId` (one being issued now). */
async function isSigned(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
  exceptDocumentId?: string,
): Promise<boolean> {
  const [signed] = await tx
    .select({ id: issuedDocuments.id })
    .from(issuedDocuments)
    .where(
      and(
        eq(issuedDocuments.operatorId, operatorId),
        eq(issuedDocuments.rentalId, rentalId),
        eq(issuedDocuments.kind, "contract"),
        exceptDocumentId ? ne(issuedDocuments.id, exceptDocumentId) : undefined,
      ),
    )
    .limit(1);
  return signed !== undefined;
}

/**
 * The contract as the Renter will sign it: the template version the link
 * was sent for, filled in as of when it was sent. If anything in it has
 * changed since (the rental's terms, the business's details), the
 * fingerprint no longer matches and it cannot be signed: the Operator sends a
 * new link.
 */
export async function loadSigningView(
  database: AnyDatabase,
  visit: LinkVisit,
): Promise<SigningView> {
  if (!visit.signing) {
    return { status: "not_signable" };
  }
  const { rentalId, templateVersionId, contractFingerprint } = visit.signing;
  const state = await withTenant(database, visit.operatorId, async (tx) => {
    const [rental] = await tx
      .select({ status: rentals.status })
      .from(rentals)
      .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, visit.operatorId)));
    return { status: rental?.status, isSigned: await isSigned(tx, visit.operatorId, rentalId) };
  });
  if (state.isSigned) {
    return { status: "signed" };
  }
  if (!state.status || !SIGNABLE_STATUSES.has(state.status)) {
    return { status: "not_signable" };
  }
  const version = await loadTemplateVersion(database, visit.operatorId, templateVersionId);
  const filled = version
    ? await fillContract(database, visit.operatorId, rentalId, version.content, {
        timeZone: visit.timeZone,
        now: visit.sentAt,
      })
    : null;
  if (!filled || filled.fingerprint !== contractFingerprint || !filled.data.renterFullName) {
    return { status: "changed" };
  }
  return {
    status: "ready",
    document: filled.document,
    fingerprint: filled.fingerprint,
    renterFullName: filled.data.renterFullName,
    details: detailRows(filled.data),
    rentalSummary: rentalSummaryText(filled.data),
  };
}

function evidenceRow(
  visit: LinkVisit,
  rentalId: string,
  step: SigningEvidenceStep,
  meta: RequestMeta,
  details: Record<string, unknown> = {},
) {
  return {
    operatorId: visit.operatorId,
    linkId: visit.linkId,
    rentalId,
    step,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    details,
  };
}

/** Records one step of signing with its time, internet address and browser (never in the log). */
export async function recordSigningEvidence(
  database: AnyDatabase,
  visit: LinkVisit,
  step: Exclude<SigningEvidenceStep, "signed">,
  meta: RequestMeta,
  details: Record<string, unknown> = {},
): Promise<void> {
  if (!visit.signing) {
    return;
  }
  const row = evidenceRow(visit, visit.signing.rentalId, step, meta, details);
  await withTenant(database, visit.operatorId, (tx) => tx.insert(signingEvidence).values(row));
}

function stepLine(timeZone: string, occurredAt: Date, meta: RequestMeta): string {
  const from = meta.ipAddress ? ` from ${meta.ipAddress}` : "";
  return `${formatDateTimeInTimeZone(occurredAt, timeZone)}${from}, ${describeDevice(meta.userAgent)}`;
}

async function signingRecordRows(
  database: AnyDatabase,
  visit: LinkVisit,
  link: { sentToEmail: string },
  signed: { at: Date; meta: RequestMeta; methodLabel: string },
): Promise<PdfSigningRecord["rows"]> {
  const steps = await withTenant(database, visit.operatorId, (tx) =>
    tx
      .select()
      .from(signingEvidence)
      .where(
        and(
          eq(signingEvidence.operatorId, visit.operatorId),
          eq(signingEvidence.linkId, visit.linkId),
        ),
      )
      .orderBy(asc(signingEvidence.occurredAt)),
  );
  return [
    ["Sent to", link.sentToEmail],
    ["Link sent", formatDateTimeInTimeZone(visit.sentAt, visit.timeZone)],
    ...steps.map(
      (step) =>
        [
          SIGNING_EVIDENCE_STEP_LABELS[step.step],
          stepLine(visit.timeZone, step.occurredAt, step),
        ] as const,
    ),
    ["Agreed to", `“${SIGNING_CONSENT_TEXT}”`],
    [SIGNING_EVIDENCE_STEP_LABELS.signed, stepLine(visit.timeZone, signed.at, signed.meta)],
    ["How they signed", signed.methodLabel],
  ];
}

export type SignContractResult =
  | { status: "signed"; signedAtText: string }
  | { status: "invalid"; fieldErrors: Record<string, string[] | undefined> }
  | { status: "signed_already" | "changed" | "not_signable" };

interface SigningDependencies extends FileDependencies {
  emailSender: EmailSender;
}

async function emailSignedCopies(
  deps: SigningDependencies,
  visit: LinkVisit,
  copies: { renterEmail: string; renterName: string; rentalSummary: string; signedAtText: string },
  pdf: Uint8Array,
): Promise<void> {
  const business = await loadBusinessDetails(deps.database, visit.operatorId);
  const attachment = {
    fileName: `${CONTRACT_TITLE} ${copies.rentalSummary}.pdf`,
    contentType: "application/pdf",
    content: pdf,
  };
  const shared = {
    renterName: copies.renterName,
    operatorName: visit.operatorName,
    rentalSummary: copies.rentalSummary,
    signedAt: copies.signedAtText,
    attachment,
  };
  const recipients = [
    { to: copies.renterEmail, audience: "renter" as const },
    ...(business?.email ? [{ to: business.email, audience: "operator" as const }] : []),
  ];
  for (const recipient of recipients) {
    try {
      await deps.emailSender.send(
        await renderContractSignedEmail({
          ...shared,
          ...recipient,
          replyTo: business?.email ?? undefined,
        }),
      );
    } catch (error) {
      // The contract is signed and kept either way; a failed copy is only logged.
      console.error("Emailing a signed contract failed", describeErrorForLog(error));
    }
  }
}

/** The signed contract's PDF: the text, the signature under it, and the signing record. */
async function renderSignedContract(
  deps: SigningDependencies,
  visit: LinkVisit,
  view: Extract<SigningView, { status: "ready" }>,
  link: { sentToEmail: string },
  input: SignContractInput,
  signed: { at: Date; text: string; meta: RequestMeta },
): Promise<Uint8Array> {
  const signature: PdfSignature = {
    signedByText: `Signed by ${view.renterFullName}`,
    signedAtText: `Signed electronically on ${signed.text}`,
    ...(input.method === "drawn"
      ? { drawnPng: decodeDrawnSignature(input.drawnSignature) ?? undefined }
      : { typedName: input.typedName }),
  };
  const methodLabel =
    input.method === "typed"
      ? `${SIGNATURE_METHOD_LABELS.typed}: “${input.typedName}”`
      : SIGNATURE_METHOD_LABELS.drawn;
  return renderDocumentPdf({
    ...(await loadPdfBranding(deps, visit.operatorId)),
    title: `${CONTRACT_TITLE} ${view.rentalSummary}`,
    document: view.document,
    signature,
    signingRecord: {
      rows: await signingRecordRows(deps.database, visit, link, {
        at: signed.at,
        meta: signed.meta,
        methodLabel,
      }),
      contentFingerprint: view.fingerprint,
    },
  });
}

/**
 * The Renter signs. Checked against the contract their page showed (its
 * fingerprint), the PDF is made with their signature and the signing record,
 * issued for good (rule 12) together with the final evidence, and the link
 * is used up. Copies go to the Renter and the business. Only one signing can
 * win: the link is locked and checked inside the issuing transaction.
 */
export async function signContract(
  deps: SigningDependencies,
  visit: LinkVisit,
  values: Record<string, string>,
  meta: RequestMeta,
): Promise<SignContractResult> {
  const view = await loadSigningView(deps.database, visit);
  if (view.status === "signed") {
    return { status: "signed_already" };
  }
  if (view.status !== "ready" || !visit.signing) {
    return { status: view.status === "changed" ? "changed" : "not_signable" };
  }
  const parsed = signContractInputSchema(view.renterFullName).safeParse(values);
  if (!parsed.success) {
    return {
      status: "invalid",
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((issue) => [String(issue.path[0]), [issue.message]]),
      ),
    };
  }
  const input = parsed.data;
  if (input.contractFingerprint !== view.fingerprint) {
    return { status: "changed" };
  }
  const { rentalId, templateVersionId } = visit.signing;
  const signedAt = deps.now();
  const signedAtText = formatDateTimeInTimeZone(signedAt, visit.timeZone);
  const [link] = await withTenant(deps.database, visit.operatorId, (tx) =>
    tx
      .select({ sentToEmail: renterLinks.sentToEmail })
      .from(renterLinks)
      .where(eq(renterLinks.id, visit.linkId)),
  );
  if (!link) {
    return { status: "not_signable" };
  }
  const pdf = await renderSignedContract(deps, visit, view, link, input, {
    at: signedAt,
    text: signedAtText,
    meta,
  });

  const result = await issueDocument(
    deps,
    { operatorId: visit.operatorId, linkId: visit.linkId },
    {
      rentalId,
      kind: "contract",
      templateVersionId,
      pdf,
      onIssued: async (tx, documentId) => {
        const [liveLink] = await tx
          .select({ id: renterLinks.id })
          .from(renterLinks)
          .where(and(eq(renterLinks.id, visit.linkId), isNull(renterLinks.cancelledAt)))
          .for("update");
        if (!liveLink || (await isSigned(tx, visit.operatorId, rentalId, documentId))) {
          throw new SignedAlreadyError();
        }
        await tx.insert(signingEvidence).values({
          ...evidenceRow(visit, rentalId, "signed", meta, {
            method: input.method,
            ...(input.method === "typed" ? { typedName: input.typedName } : {}),
            consentText: SIGNING_CONSENT_TEXT,
            contractFingerprint: view.fingerprint,
            areDetailsConfirmed: true,
          }),
          occurredAt: signedAt,
          issuedDocumentId: documentId,
        });
        await tx
          .update(renterLinks)
          .set({ cancelledAt: signedAt, updatedAt: signedAt })
          .where(eq(renterLinks.id, visit.linkId));
        await recordActivity(tx, {
          operatorId: visit.operatorId,
          actor: { type: "renter_link", id: visit.linkId },
          entityType: ACTIVITY_ENTITY_TYPES.rental,
          entityId: rentalId,
          action: ACTIVITY_ACTIONS.signed,
          valuesAfter: { method: input.method, documentId },
        });
      },
    },
  ).catch((error: unknown) => {
    if (error instanceof SignedAlreadyError) {
      return null;
    }
    throw error;
  });
  if (!result) {
    return { status: "signed_already" };
  }
  if (result.status !== "issued") {
    return { status: "not_signable" };
  }
  await emailSignedCopies(
    deps,
    visit,
    {
      renterEmail: link.sentToEmail,
      renterName: view.renterFullName,
      rentalSummary: view.rentalSummary,
      signedAtText,
    },
    pdf,
  );
  return { status: "signed", signedAtText };
}

/** Thrown inside the issuing transaction when another signing got there first: nothing is kept. */
class SignedAlreadyError extends Error {
  constructor() {
    super("The contract was already signed through this link.");
  }
}
