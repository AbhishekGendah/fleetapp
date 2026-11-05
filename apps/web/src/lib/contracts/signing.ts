import {
  decodeDrawnSignature,
  describeDevice,
  formatDateTimeInTimeZone,
  SIGNATURE_METHOD_LABELS,
  SIGNING_CONSENT_TEXT,
  SIGNING_EVIDENCE_STEP_LABELS,
  signContractInputSchema,
  type ContractData,
  type SignContractInput,
  type SigningEvidenceStep,
  type TemplateDocument,
  isContractSignable,
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
import type { EmailSender } from "@fleetapp/email";
import { and, asc, eq, ne } from "drizzle-orm";

import type { FileDependencies } from "../files/stored-files";
import type { LinkVisit } from "../renter-links/link-visits";
import type { RequestMeta } from "../request-meta";
import {
  changeFieldsOf,
  changeSigningProblemNow,
  lockChange,
  recordChangeSigned,
  type RentalChange,
} from "../rentals/rental-changes";
import { loadPdfBranding } from "./contract-pdf";
import { emailDocumentCopies } from "./document-copies";
import type { RenterLinkInPlay } from "../renter-links/details-links";
import { renderDocumentPdf, type PdfSignature, type PdfSigningRecord } from "./document-pdf";
import { fillContract, type FilledContract } from "./filled-contract";
import { issueDocument } from "./issued-documents";
import { rentalSummaryText, type SentPaperOfLink } from "./signing-links";
import { loadTemplateVersion } from "./templates";

/** What a signing link signs: the rental's contract, or one change of terms. */
export type SignedDocumentKind = "contract" | "change_of_terms";

const DOCUMENT_TITLES: Readonly<Record<SignedDocumentKind, string>> = {
  contract: "Rental contract",
  change_of_terms: "Change of terms",
};

/** What the Renter checks before reading: label and value, in their own words. */
export type DetailRow = readonly [label: string, value: string];

export type SigningView =
  | {
      status: "ready";
      kind: SignedDocumentKind;
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

/** Where the link's document stands: open to sign, signed, or no longer signable. */
interface SigningState {
  kind: SignedDocumentKind;
  status: "open" | "signed" | "not_signable";
  change: RentalChange | null;
  /** When the car went out: a rate change's rent week is counted from it. */
  handedOverAt: Date | null;
}

async function signingStateOf(
  tx: AnyTransaction,
  operatorId: string,
  signing: NonNullable<LinkVisit["signing"]>,
  now: Date,
): Promise<SigningState> {
  const [rental] = await tx
    .select({ status: rentals.status, handedOverAt: rentals.handedOverAt })
    .from(rentals)
    .where(and(eq(rentals.id, signing.rentalId), eq(rentals.operatorId, operatorId)));
  const handedOverAt = rental?.handedOverAt ?? null;
  if (signing.rentalChangeId) {
    const change = await lockChange(tx, operatorId, signing.rentalChangeId);
    if (change?.documentId) {
      return { kind: "change_of_terms", status: "signed", change, handedOverAt };
    }
    const isOpen =
      change !== null &&
      rental !== undefined &&
      (await changeSigningProblemNow(tx, operatorId, change, rental, now)) === null;
    const status = isOpen ? "open" : "not_signable";
    return { kind: "change_of_terms", status, change, handedOverAt };
  }
  if (await isSigned(tx, operatorId, signing.rentalId)) {
    return { kind: "contract", status: "signed", change: null, handedOverAt };
  }
  const isOpen = rental !== undefined && isContractSignable(rental.status);
  return {
    kind: "contract",
    status: isOpen ? "open" : "not_signable",
    change: null,
    handedOverAt,
  };
}

/** A sent paper as it would read now: the link's own template version, as of when it was sent. */
interface SentPaper {
  rentalId: string;
  templateVersionId: string;
  sentAt: Date;
  change: RentalChange | null;
  handedOverAt: Date | null;
  timeZone: string;
}

async function fillSentPaper(
  database: AnyDatabase,
  operatorId: string,
  sent: SentPaper,
): Promise<FilledContract | null> {
  const version = await loadTemplateVersion(database, operatorId, sent.templateVersionId);
  return version
    ? fillContract(
        database,
        operatorId,
        sent.rentalId,
        version.content,
        { timeZone: sent.timeZone, now: sent.sentAt },
        sent.change ? changeFieldsOf(sent.change, sent.timeZone, sent.handedOverAt) : undefined,
      )
    : null;
}

/**
 * Whether a sent contract or change form no longer matches the rental (its
 * end, the Renter's address, the excess changed since): the Renter can't
 * sign that link, so the rental page says so (review A3-6). The same check
 * the Renter's signing page makes, so the two always agree.
 */
export async function isSentPaperChanged(
  database: AnyDatabase,
  operatorId: string,
  sent: SentPaper & { contractFingerprint: string },
): Promise<boolean> {
  const filled = await fillSentPaper(database, operatorId, sent);
  return !filled || filled.fingerprint !== sent.contractFingerprint;
}

/** A link as the rental page shows it, marked if its paper no longer matches the rental. */
export async function withPaperCheck(
  database: AnyDatabase,
  operatorId: string,
  shown: {
    link: RenterLinkInPlay | null;
    sentPaper: SentPaperOfLink | null;
    rentalId: string;
    change: RentalChange | null;
    handedOverAt: Date | null;
    timeZone: string;
  },
): Promise<RenterLinkInPlay | null> {
  if (!shown.link || !shown.sentPaper) {
    return shown.link;
  }
  const isPaperChanged = await isSentPaperChanged(database, operatorId, {
    ...shown.sentPaper,
    rentalId: shown.rentalId,
    change: shown.change,
    handedOverAt: shown.handedOverAt,
    timeZone: shown.timeZone,
  });
  return { ...shown.link, isPaperChanged };
}

/**
 * The document as the Renter will sign it: the template version the link
 * was sent for, filled in as of when it was sent (with the change's own
 * fields for a change of terms). If anything in it has changed since (the
 * rental's terms, the business's details), the fingerprint no longer
 * matches and it cannot be signed: the Operator sends a new link.
 */
export async function loadSigningView(
  database: AnyDatabase,
  visit: LinkVisit,
  now: Date = new Date(),
): Promise<SigningView> {
  const { signing } = visit;
  if (!signing) {
    return { status: "not_signable" };
  }
  const state = await withTenant(database, visit.operatorId, (tx) =>
    signingStateOf(tx, visit.operatorId, signing, now),
  );
  if (state.status !== "open") {
    return { status: state.status };
  }
  const filled = await fillSentPaper(database, visit.operatorId, {
    rentalId: signing.rentalId,
    templateVersionId: signing.templateVersionId,
    sentAt: visit.sentAt,
    change: state.change,
    handedOverAt: state.handedOverAt,
    timeZone: visit.timeZone,
  });
  if (
    !filled ||
    filled.fingerprint !== signing.contractFingerprint ||
    !filled.data.renterFullName
  ) {
    return { status: "changed" };
  }
  return {
    status: "ready",
    kind: state.kind,
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
  | {
      status: "signed";
      signedAtText: string;
      /** Whether the Renter's copy actually went: the screen says so only if it did (review G7-1). */
      isCopyEmailed: boolean;
    }
  | { status: "invalid"; fieldErrors: Record<string, string[] | undefined> }
  | { status: "signed_already" | "link_stopped" | "changed" | "not_signable" };

interface SigningDependencies extends FileDependencies {
  emailSender: EmailSender;
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
    title: `${DOCUMENT_TITLES[view.kind]} ${view.rentalSummary}`,
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
  const view = await loadSigningView(deps.database, visit, deps.now());
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
      kind: view.kind,
      templateVersionId,
      pdf,
      onIssued: async (tx, documentId) => {
        const [link] = await tx
          .select({ cancelledAt: renterLinks.cancelledAt, usedAt: renterLinks.usedAt })
          .from(renterLinks)
          .where(eq(renterLinks.id, visit.linkId))
          .for("update");
        if (link?.usedAt) {
          throw new SignedAlreadyError();
        }
        if (!link || link.cancelledAt) {
          // Re-sent, cancelled or withdrawn by the business meanwhile: nothing is signed (review A3-7).
          throw new LinkStoppedError();
        }
        await recordSigned(tx, visit, {
          documentId,
          at: signedAt,
          kind: view.kind,
          method: input.method,
        });
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
          .set({ cancelledAt: signedAt, usedAt: signedAt, updatedAt: signedAt })
          .where(eq(renterLinks.id, visit.linkId));
      },
    },
  ).catch((error: unknown) => {
    if (error instanceof SignedAlreadyError) {
      return "signed_already" as const;
    }
    if (error instanceof LinkStoppedError) {
      return "link_stopped" as const;
    }
    throw error;
  });
  if (typeof result === "string") {
    return { status: result };
  }
  if (result.status !== "issued") {
    return { status: "not_signable" };
  }
  const emailed = await emailDocumentCopies(deps, {
    documentId: result.documentId,
    kind: view.kind,
    operatorId: visit.operatorId,
    renterEmail: link.sentToEmail,
    renterName: view.renterFullName,
    rentalSummary: view.rentalSummary,
    atText: signedAtText,
    fileName: `${DOCUMENT_TITLES[view.kind]} ${view.rentalSummary}.pdf`,
    pdf,
  });
  return { status: "signed", signedAtText, isCopyEmailed: emailed.renter === "sent" };
}

/**
 * Inside the issuing transaction: refuses a second signing (another phone
 * got there first), then records what signing does. A contract is logged on
 * the rental; a change of terms keeps its form and, if it was waiting, takes
 * effect (a rate change becomes a rate).
 */
async function recordSigned(
  tx: AnyTransaction,
  visit: LinkVisit,
  signed: { documentId: string; at: Date; kind: SignedDocumentKind; method: string },
): Promise<void> {
  const signing = visit.signing!;
  const actor = { type: "renter_link" as const, id: visit.linkId };
  if (signed.kind === "contract") {
    if (await isSigned(tx, visit.operatorId, signing.rentalId, signed.documentId)) {
      throw new SignedAlreadyError();
    }
    await recordActivity(tx, {
      operatorId: visit.operatorId,
      actor,
      entityType: ACTIVITY_ENTITY_TYPES.rental,
      entityId: signing.rentalId,
      action: ACTIVITY_ACTIONS.signed,
      valuesAfter: { method: signed.method, documentId: signed.documentId },
    });
    return;
  }
  const change = await lockChange(tx, visit.operatorId, signing.rentalChangeId ?? "");
  if (change?.documentId) {
    throw new SignedAlreadyError();
  }
  // Checked again under the lock: withdrawn, replaced, or its rent week begun since the
  // page was opened means it is not signed (review A3-1, A3-12).
  const [rental] = await tx
    .select({ status: rentals.status, handedOverAt: rentals.handedOverAt })
    .from(rentals)
    .where(and(eq(rentals.id, signing.rentalId), eq(rentals.operatorId, visit.operatorId)));
  const problem =
    change && rental
      ? await changeSigningProblemNow(tx, visit.operatorId, change, rental, signed.at)
      : "withdrawn";
  if (!change || problem) {
    throw new LinkStoppedError();
  }
  await recordChangeSigned(tx, visit.operatorId, change, signed);
  await recordActivity(tx, {
    operatorId: visit.operatorId,
    actor,
    entityType: ACTIVITY_ENTITY_TYPES.rentalChange,
    entityId: change.id,
    action: ACTIVITY_ACTIONS.signed,
    valuesAfter: {
      method: signed.method,
      documentId: signed.documentId,
      rentalId: change.rentalId,
    },
  });
}

/** Thrown inside the issuing transaction when another signing got there first: nothing is kept. */
class SignedAlreadyError extends Error {
  constructor() {
    super("The contract was already signed through this link.");
  }
}

/** Thrown inside the issuing transaction when the business stopped the link or the change first. */
class LinkStoppedError extends Error {
  constructor() {
    super("The link was stopped before it was signed.");
  }
}
