import { formatDateTimeInTimeZone, type DocumentEmailState } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { Button } from "@fleetapp/ui/button";
import { RecordItem } from "@fleetapp/ui/record-list";
import { FileCheck2 } from "lucide-react";

import { rentalDocumentPath } from "../../../lib/paths";
import { DocumentEmailStatus } from "./document-email-status";

/**
 * A fixed document on the rental's page: its button opens that one
 * document by its own ID (review G9-5), and beside it whether its copies
 * really went, with "Email again" if not (review G9-9).
 */
export function IssuedPaper(props: {
  rentalId: string;
  kind: Parameters<typeof rentalDocumentPath>[1];
  documentId: string;
  label: string;
  emails: ReadonlyMap<string, DocumentEmailState>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Button asChild variant="outline" className="w-full sm:w-auto sm:self-start">
        <a
          href={rentalDocumentPath(props.rentalId, props.kind, props.documentId)}
          target="_blank"
          rel="noopener"
        >
          <FileCheck2 aria-hidden />
          {props.label}
        </a>
      </Button>
      <DocumentEmailStatus
        rentalId={props.rentalId}
        documentId={props.documentId}
        state={props.emails.get(props.documentId)}
      />
    </div>
  );
}

/** One paper of a finished swap or driver change, as its item lists it. */
export interface PairPaper {
  kind: Parameters<typeof rentalDocumentPath>[1];
  documentId: string;
  label: string;
}

/**
 * A finished car swap or driver change on the rental's page (review G9-5):
 * what changed, why and when, and each of its papers.
 */
export function FinishedPairItem(props: {
  title: string;
  badge: string;
  reason: string;
  /** "Swapped" or "Changed", then when. */
  doneWord: string;
  doneAt: Date | null;
  timeZone: string;
  rentalId: string;
  papers: readonly PairPaper[];
  emails: ReadonlyMap<string, DocumentEmailState>;
}) {
  return (
    <RecordItem
      title={props.title}
      aside={<Badge tone="good">{props.badge}</Badge>}
      details={
        <>
          <p>{props.reason}</p>
          {props.doneAt ? (
            <p>
              {props.doneWord} {formatDateTimeInTimeZone(props.doneAt, props.timeZone)}
            </p>
          ) : null}
        </>
      }
      actions={
        <div className="flex flex-col gap-3">
          {props.papers.map((paper) => (
            <IssuedPaper
              key={paper.documentId}
              rentalId={props.rentalId}
              kind={paper.kind}
              documentId={paper.documentId}
              label={paper.label}
              emails={props.emails}
            />
          ))}
        </div>
      }
    />
  );
}
