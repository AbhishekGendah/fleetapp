import type { SigningEvidenceStep } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { signingEvidence } from "@fleetapp/db/schema";

import type { LinkVisit } from "../renter-links/link-visits";
import type { RequestMeta } from "../request-meta";

/** One step of signing as stored: its time, internet address and browser (never in the log). */
export function evidenceRow(
  visit: LinkVisit,
  rentalId: string,
  step: SigningEvidenceStep,
  meta: RequestMeta,
  details: Record<string, unknown> = {},
): typeof signingEvidence.$inferInsert {
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

/**
 * Records one step of a signing link's evidence inside the caller's
 * transaction, so it is saved with what it proves or not at all. Nothing for
 * a link that is not a signing link.
 */
export async function insertSigningEvidence(
  tx: AnyTransaction,
  visit: LinkVisit,
  step: Exclude<SigningEvidenceStep, "signed">,
  meta: RequestMeta,
  details: Record<string, unknown> = {},
): Promise<void> {
  if (!visit.signing) {
    return;
  }
  await tx
    .insert(signingEvidence)
    .values(evidenceRow(visit, visit.signing.rentalId, step, meta, details));
}
