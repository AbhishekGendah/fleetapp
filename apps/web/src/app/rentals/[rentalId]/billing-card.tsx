import {
  billingDocumentTitle,
  formatCents,
  formatDayInTimeZone,
  pendingDocuments,
  todayInTimeZone,
  type RentalStatus,
} from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { FileText, Mail, ReceiptText } from "lucide-react";

import { appDb } from "../../../lib/app-db";
import {
  listBillingDocuments,
  type BillingDocumentSummary,
} from "../../../lib/billing/billing-queries";
import { STATEMENT_TITLE } from "../../../lib/billing/billing-statements";
import { loadRentalLedger } from "../../../lib/ledger/ledger-queries";
import { rentalDocumentPath } from "../../../lib/paths";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import type { SignedInUser } from "../../../lib/require-user";
import {
  emailDocumentAgainAction,
  issueInvoiceNowAction,
  issueStatementAction,
} from "./billing-actions";
import { StatementForm } from "./statement-form";

/**
 * A draft has no money, so nothing to invoice. A cancelled booking keeps its
 * documents in view, so its money is never stranded (review A4-5).
 */
const HAS_DOCUMENTS: ReadonlySet<RentalStatus> = new Set([
  "booked",
  "active",
  "returned",
  "closed",
  "cancelled",
]);

function titleOf(document: BillingDocumentSummary): string {
  const title =
    document.kind === "statement"
      ? STATEMENT_TITLE
      : billingDocumentTitle(document.kind, document.isTaxDocument);
  return document.numberText ? `${title} ${document.numberText}` : title;
}

function DocumentItem(props: {
  rentalId: string;
  document: BillingDocumentSummary;
  timeZone: string;
}) {
  const { document } = props;
  return (
    <RecordItem
      title={titleOf(document)}
      amount={document.totalCents === null ? null : formatCents(document.totalCents)}
      details={
        <>
          <span>{formatDayInTimeZone(document.issuedAt, props.timeZone)}</span>
          {document.gstCents ? <span>Includes GST {formatCents(document.gstCents)}</span> : null}
        </>
      }
      actions={
        <>
          <Button asChild variant="outline">
            {/* A plain link, as Next's would fetch the PDF ahead of time for every row. */}
            <a
              href={rentalDocumentPath(props.rentalId, document.kind, document.issuedDocumentId)}
              target="_blank"
              rel="noopener"
            >
              <FileText aria-hidden />
              Open
              <span className="sr-only"> {titleOf(document)}</span>
            </a>
          </Button>
          <ActionButton
            action={emailDocumentAgainAction.bind(null, props.rentalId, document.issuedDocumentId)}
            label={`Email again`}
            pendingLabel="Sending…"
            icon={<Mail aria-hidden />}
          />
        </>
      }
    />
  );
}

/**
 * The rental's invoices, credit notes, receipts and statements (rule 12):
 * each fixed once issued, opened as its PDF or emailed to the Renter again.
 * One-off charges waiting for the next weekly invoice can be invoiced now.
 */
export async function BillingCard(props: {
  rental: RentalDetail;
  user: SignedInUser;
  clock: RentalClock;
}) {
  const { rental, user, clock } = props;
  if (!HAS_DOCUMENTS.has(rental.status)) {
    return null;
  }
  const [documents, ledger] = await Promise.all([
    listBillingDocuments(appDb, user.operatorId, rental.id),
    loadRentalLedger(appDb, user.operatorId, rental.id),
  ]);
  const waitingCount = pendingDocuments(ledger.lines, {
    isOneOffWaitingForRent: true,
    isInvoicedNow: true,
  }).invoiceLineIds.length;
  const today = todayInTimeZone(clock.now, clock.timeZone);
  const firstDay = todayInTimeZone(rental.handedOverAt ?? clock.now, clock.timeZone);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices and receipts</CardTitle>
        <CardDescription>
          Issued by themselves as rent is charged and payments are recorded, and emailed to the
          Renter. Each is fixed once issued: a mistake is put right with a credit note.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {waitingCount > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              {waitingCount === 1 ? "1 charge is" : `${waitingCount} charges are`} waiting for the
              next weekly invoice.
            </p>
            <ActionButton
              action={issueInvoiceNowAction.bind(null, rental.id)}
              label="Invoice now"
              pendingLabel="Issuing…"
              icon={<ReceiptText aria-hidden />}
            />
          </div>
        ) : null}
        {documents.length > 0 ? (
          <RecordList label="Invoices and receipts">
            {documents.map((document) => (
              <DocumentItem
                key={document.issuedDocumentId}
                rentalId={rental.id}
                document={document}
                timeZone={clock.timeZone}
              />
            ))}
          </RecordList>
        ) : (
          <p className="text-muted-foreground text-sm">Nothing issued yet.</p>
        )}
        <div>
          <FormDialog
            triggerLabel="Statement"
            title="Make a statement"
            triggerIcon={<FileText aria-hidden />}
          >
            <StatementForm
              action={issueStatementAction.bind(null, rental.id)}
              fromDate={firstDay}
              today={today}
            />
          </FormDialog>
        </div>
      </CardContent>
    </Card>
  );
}
