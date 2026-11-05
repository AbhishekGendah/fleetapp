import type { DocumentEmailState } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
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
