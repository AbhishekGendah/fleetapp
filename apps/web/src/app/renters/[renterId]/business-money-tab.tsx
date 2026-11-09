import {
  billingDocumentTitle,
  DIRECT_DEBIT_STATE_LABELS,
  formatCalendarDate,
  formatCents,
  formatDayInTimeZone,
  renterShownName,
  todayInTimeZone,
} from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Badge } from "@fleetapp/ui/badge";
import { Button } from "@fleetapp/ui/button";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { FileText, Mail } from "lucide-react";

import { SectionCard } from "../../../components/section-card";
import { StatementForm } from "../../../components/statement-form";
import { appDb } from "../../../lib/app-db";
import { BUSINESS_STATEMENT_TICKED } from "../../../lib/billing/statement-input";
import {
  listRenterStatements,
  type RenterStatementSummary,
} from "../../../lib/billing/business-statements";
import { rentalDocumentPath, renterStatementPath } from "../../../lib/paths";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import type { SignedInUser } from "../../../lib/require-user";
import {
  loadBusinessMoneyCards,
  type BusinessInvoice,
  type RentalBondHeld,
} from "../../../lib/renters/business-money-cards";
import type { RenterDetail } from "../../../lib/renters/renter-queries";
import { DIRECT_DEBIT_TONES } from "../../rentals/[rentalId]/payments-card";
import type { BusinessPageData } from "./business-page-data";
import { QUIET_LINE_CLASSES, TWO_COLUMNS_CLASSES } from "./card-lines";
import { CarsMoneyCard, LedgerCard } from "./money-tab";
import { emailStatementAgainAction, issueBusinessStatementAction } from "./statement-actions";

/** The id the Overview's "Send a statement" opens the Money tab at. */
export const STATEMENT_CARD_ID = "statement";

/** How a statement was last emailed, in a few words: "Emailed to Dana Wells Sun 1 Nov". */
function emailedText(
  statement: RenterStatementSummary,
  contactName: string,
  timeZone: string,
): string {
  const { lastEmail } = statement;
  if (!lastEmail) {
    return "Not emailed";
  }
  const when = formatDayInTimeZone(lastEmail.triedAt, timeZone);
  if (lastEmail.outcome === "sent") {
    return `Emailed to ${contactName} ${when}`;
  }
  return lastEmail.outcome === "no_address"
    ? "Not emailed: no email on file"
    : `Email failed ${when}`;
}

/**
 * One PDF across all the business's cars, grouped by car (mockup 8), for
 * any days, emailed to its contact when ticked; each one kept as issued.
 */
function StatementCard(props: {
  renter: RenterDetail;
  statements: readonly RenterStatementSummary[];
  firstDay: string;
  clock: RentalClock;
}) {
  const { renter, clock } = props;
  const contactName = renter.contactName ?? renterShownName(renter);
  return (
    <SectionCard heading="Statement" headingId={STATEMENT_CARD_ID}>
      <div className="flex flex-col gap-4 border-t py-3">
        <p className="text-muted-foreground text-sm">
          {`One PDF across all ${renterShownName(renter)}'s cars, grouped by car. It is a statement, not a tax invoice.`}
        </p>
        {renter.archivedAt ? (
          <p className="text-sm">
            Archived: restore it on its Details tab to make a new statement. Its statements are kept
            below.
          </p>
        ) : (
          <StatementForm
            action={issueBusinessStatementAction.bind(null, renter.id)}
            fromDate={props.firstDay}
            today={todayInTimeZone(clock.now, clock.timeZone)}
            submitLabel="Make statement"
          >
            <Checkbox
              name="isEmailed"
              value={BUSINESS_STATEMENT_TICKED}
              defaultChecked={renter.email !== null}
              disabled={renter.email === null}
              label={
                renter.email
                  ? `Email it to ${contactName}`
                  : "No email on file: add one on the Details tab to email it"
              }
            />
          </StatementForm>
        )}
      </div>
      {props.statements.length === 0 ? (
        <p className={QUIET_LINE_CLASSES}>No statements made yet.</p>
      ) : (
        <RecordList label="Statements made">
          {props.statements.map((statement) => (
            <RecordItem
              key={statement.id}
              title={`Statement ${statement.version}`}
              details={
                <>
                  <span>Made {formatDayInTimeZone(statement.issuedAt, clock.timeZone)}</span>
                  <span>{emailedText(statement, contactName, clock.timeZone)}</span>
                </>
              }
              actions={
                <>
                  <Button asChild variant="outline">
                    {/* A plain link, as Next's would fetch the PDF ahead of time for every row. */}
                    <a
                      href={renterStatementPath(renter.id, statement.id)}
                      target="_blank"
                      rel="noopener"
                    >
                      <FileText aria-hidden />
                      Open
                      <span className="sr-only"> statement {statement.version}</span>
                    </a>
                  </Button>
                  {renter.email ? (
                    <ActionButton
                      action={emailStatementAgainAction.bind(null, renter.id, statement.id)}
                      label="Email again"
                      pendingLabel="Sending…"
                      icon={<Mail aria-hidden />}
                    />
                  ) : null}
                </>
              }
            />
          ))}
        </RecordList>
      )}
    </SectionCard>
  );
}

/** Its one direct debit covers all its cars; each car is debited on its own (decision 6). */
function HowItPaysCard(props: {
  renter: RenterDetail;
  directDebit: keyof typeof DIRECT_DEBIT_STATE_LABELS;
}) {
  return (
    <SectionCard heading={`How ${renterShownName(props.renter)} pays`}>
      <div className="flex flex-col gap-2 border-t py-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          Direct debit:
          <Badge tone={DIRECT_DEBIT_TONES[props.directDebit]}>
            {DIRECT_DEBIT_STATE_LABELS[props.directDebit]}
          </Badge>
        </p>
        <p className="text-muted-foreground">
          {`From ${props.renter.fullName}'s bank. One setup covers all its cars; each car is debited on its own. Stripe holds the bank details.`}
        </p>
      </div>
    </SectionCard>
  );
}

/** The bond held on each of its cars, kept apart from what it owes. */
function BondsCard({ bonds }: { bonds: readonly RentalBondHeld[] }) {
  const heldCents = bonds.reduce((total, bond) => total + bond.heldCents, 0);
  return (
    <SectionCard heading="Bonds">
      <div className="flex flex-col gap-1 border-t py-3">
        <span className="text-primary text-2xl font-extrabold">{`${formatCents(heldCents)} held`}</span>
        <span className="text-muted-foreground text-sm">
          {bonds.length === 0
            ? "No bond is held on any of its cars."
            : `${bonds.map((bond) => `${formatCents(bond.heldCents)} on ${bond.rego}`).join(", ")}. Each car's bond is held on its own rental.`}
        </span>
      </div>
    </SectionCard>
  );
}

function invoiceTitle(invoice: BusinessInvoice): string {
  return `${billingDocumentTitle(invoice.kind, invoice.isTaxDocument)} ${invoice.numberText}`;
}

/** Its latest invoices across cars, each opening its PDF from the car's rental. */
function LatestInvoicesCard(props: { renter: RenterDetail; invoices: readonly BusinessInvoice[] }) {
  return (
    <SectionCard heading="Latest invoices">
      <p className="text-muted-foreground border-t py-3 text-sm">
        {`One per car per week, addressed to ${props.renter.fullName} with its ABN, showing the car and driver.`}
      </p>
      {props.invoices.length === 0 ? (
        <p className={QUIET_LINE_CLASSES}>No invoices yet.</p>
      ) : (
        <RecordList label="Latest invoices">
          {props.invoices.map((invoice) => (
            <RecordItem
              key={invoice.issuedDocumentId}
              title={`${invoiceTitle(invoice)} · ${invoice.rego}`}
              amount={formatCents(invoice.totalCents)}
              details={<span>Issued {formatCalendarDate(invoice.issuedOn)}</span>}
              actions={
                <Button asChild variant="outline">
                  <a
                    href={rentalDocumentPath(
                      invoice.rentalId,
                      invoice.kind,
                      invoice.issuedDocumentId,
                    )}
                    target="_blank"
                    rel="noopener"
                  >
                    <FileText aria-hidden />
                    Open
                    <span className="sr-only"> {invoiceTitle(invoice)}</span>
                  </a>
                </Button>
              }
            />
          ))}
        </RecordList>
      )}
    </SectionCard>
  );
}

/**
 * A business's Money tab (7 Nov 2026 mockups): its cars one by one and every
 * line across them (rule 11), beside its statement across cars, how it pays,
 * its bonds and its latest invoices. Charges and payments are added on each
 * car's rental.
 */
export async function BusinessMoneyTab(props: {
  renter: RenterDetail;
  user: SignedInUser;
  business: BusinessPageData;
  clock: RentalClock;
}) {
  const { renter, user, business, clock } = props;
  const [cards, statements] = await Promise.all([
    loadBusinessMoneyCards(appDb, user.operatorId, renter.id),
    listRenterStatements(appDb, user.operatorId, renter.id),
  ]);
  const firstDay = todayInTimeZone(renter.createdAt, clock.timeZone);
  return (
    <div className={TWO_COLUMNS_CLASSES}>
      <div className="flex flex-col gap-4">
        <CarsMoneyCard cars={business.moneyByCar} isCut={business.isMoneyByCarCut} />
        <LedgerCard renterId={renter.id} user={user} isBusiness />
      </div>
      <div className="flex flex-col gap-4">
        <StatementCard renter={renter} statements={statements} firstDay={firstDay} clock={clock} />
        <HowItPaysCard renter={renter} directDebit={cards.directDebit} />
        <BondsCard bonds={cards.bonds} />
        <LatestInvoicesCard renter={renter} invoices={cards.latestInvoices} />
      </div>
    </div>
  );
}
