import type { HandoverGap } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";

import type { ActingUser } from "../acting-user";
import { issueDocument } from "../contracts/issued-documents";
import type { FileDependencies } from "../files/stored-files";
import type { HandoverView } from "./handover-queries";

/** Thrown inside the issuing transaction when the checklist was finished elsewhere: nothing is kept. */
export class FinishedAlreadyError extends Error {}

/** What stops any checklist being finished: something missing, or kilometres gone down. */
export function checklistRefusal(
  view: HandoverView,
): { status: "gaps"; gaps: HandoverGap[] } | { status: "lower"; lastKilometres: number } | null {
  if (view.gaps.length > 0) {
    return { status: "gaps", gaps: view.gaps };
  }
  if (view.lastKilometres !== null && (view.odometerKm ?? 0) < view.lastKilometres) {
    return { status: "lower", lastKilometres: view.lastKilometres };
  }
  return null;
}

export type IssuedReport =
  { status: "issued"; documentId: string } | { status: "finished_already" | "not_found" };

/**
 * Issues a checklist's report for good (rule 12) in the same transaction
 * as `onIssued`, which records what the checklist changes. Finished on
 * another phone first: nothing is kept.
 */
export async function issueChecklistReport(
  deps: FileDependencies,
  actor: ActingUser,
  request: {
    view: HandoverView;
    kind: "handover_report" | "return_report";
    pdf: Uint8Array;
    onIssued: (tx: AnyTransaction) => Promise<void>;
  },
): Promise<IssuedReport> {
  const issued = await issueDocument(deps, actor, {
    rentalId: request.view.rentalId,
    kind: request.kind,
    templateVersionId: null,
    inspectionId: request.view.inspectionId,
    pdf: request.pdf,
    onIssued: request.onIssued,
  }).catch((error: unknown) => {
    if (error instanceof FinishedAlreadyError) {
      return null;
    }
    throw error;
  });
  if (!issued) {
    return { status: "finished_already" };
  }
  return issued.status === "issued"
    ? { status: "issued", documentId: issued.documentId }
    : { status: "not_found" };
}
