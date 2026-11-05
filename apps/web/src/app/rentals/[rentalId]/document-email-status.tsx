import { canEmailAgain, documentEmailText, type DocumentEmailState } from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Mail } from "lucide-react";

import { emailDocumentAgainAction } from "./document-email-actions";

/**
 * Whether a fixed document's copies really went, from their own record,
 * with "Email again" when one didn't (review G7-1, G9-9).
 */
export function DocumentEmailStatus(props: {
  rentalId: string;
  documentId: string;
  state: DocumentEmailState | undefined;
}) {
  // No record at all (issued before copies were recorded): nothing is claimed either way.
  if (!props.state || (props.state.renter === null && props.state.business === null)) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm">{documentEmailText(props.state)}</p>
      {canEmailAgain(props.state) ? (
        <ActionButton
          action={emailDocumentAgainAction.bind(null, props.rentalId, props.documentId)}
          label="Email again"
          pendingLabel="Emailing…"
          variant="outline"
          icon={<Mail aria-hidden />}
        />
      ) : null}
    </div>
  );
}
