import {
  formatCalendarDate,
  formatDateTimeInTimeZone,
  LICENCE_CLASS_LABELS,
  LICENCE_TYPE_LABELS,
  type ExpiryStatus,
} from "@fleetapp/core";
import { Badge, type BadgeTone } from "@fleetapp/ui/badge";
import { InlineRecordLink } from "@fleetapp/ui/row-link";
import Link from "next/link";

import { BalanceText, balanceWordsText } from "../../../components/balance-amount";
import { SectionCard, SectionLink } from "../../../components/section-card";
import { appDb } from "../../../lib/app-db";
import { carPath } from "../../../lib/paths";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import type { SignedInUser } from "../../../lib/require-user";
import { callHref, emailHref, textHref } from "../../../lib/renters/contact-links";
import { listLicenceScans } from "../../../lib/renters/licence-scans";
import { licenceIssuedInText } from "../../../lib/renters/licence-text";
import { listNotes } from "../../../lib/renters/notes";
import { findRentersSharingContact, type RenterDetail } from "../../../lib/renters/renter-queries";
import type { RentalSummary } from "../../../lib/rentals/rental-queries";
import { LatestMoneyLines } from "../../rentals/[rentalId]/overview-cards";
import { RentalRow } from "../../rentals/rental-row";
import { DetailsLinkCard } from "./details-link-card";
import { SharedContactNote, StillNeededCard } from "./renter-alerts";
import type { RenterPageData } from "./renter-page-data";
import { RENTER_TAB_LINKS } from "./renter-tabs";

const QUIET_LINE_CLASSES = "text-muted-foreground border-t py-3 text-sm";
const CONTACT_LINK_CLASSES =
  "text-teal hover:text-primary inline-flex min-h-11 items-center px-2 text-sm font-bold";

/** What they owe across their rentals, how late if overdue, and the newest lines. */
function MoneyCard({ renter, data }: { renter: RenterDetail; data: RenterPageData }) {
  const { ledger, overdue } = data;
  return (
    <SectionCard
      heading="Money"
      aside={<SectionLink href={RENTER_TAB_LINKS.href(renter.id, "money")}>All money</SectionLink>}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-t py-3">
        <span className="text-2xl">
          <BalanceText
            balanceCents={ledger.balanceCents}
            text={balanceWordsText(ledger.balanceCents)}
          />
        </span>
        {overdue ? (
          <Badge tone="danger">
            Overdue · {overdue.daysLate === 1 ? "1 day" : `${overdue.daysLate} days`}
          </Badge>
        ) : null}
      </div>
      <LatestMoneyLines ledger={ledger} showRego />
      {ledger.lines.length > 0 ? (
        <p className="text-muted-foreground border-t py-3 text-sm">
          Charges and payments are added on each rental&rsquo;s page.
        </p>
      ) : null}
    </SectionCard>
  );
}

/** A rental of theirs, led by its car's rego (which opens the car). */
function RenterRentalRow(props: { lead?: string; rental: RentalSummary; clock: RentalClock }) {
  const { rental } = props;
  return (
    <RentalRow
      lead={
        <>
          {props.lead ? `${props.lead} ` : null}
          <InlineRecordLink asChild>
            <Link href={carPath(rental.vehicleId)}>{rental.rego}</Link>
          </InlineRecordLink>{" "}
          · {rental.make} {rental.model}
        </>
      }
      rentalName={`Rental of ${rental.rego}`}
      rental={rental}
      clock={props.clock}
    />
  );
}

/** The car they have now and their next booking, or when they last had one. */
function NowCard(props: { renter: RenterDetail; data: RenterPageData; clock: RentalClock }) {
  const { rentalsUnderWay, renting } = props.data;
  const out = rentalsUnderWay.find((rental) => rental.status === "active") ?? null;
  const next = rentalsUnderWay.find((rental) => rental.status === "booked") ?? null;
  return (
    <SectionCard
      heading="Now"
      aside={
        <SectionLink href={RENTER_TAB_LINKS.href(props.renter.id, "rentals")}>
          All rentals
        </SectionLink>
      }
    >
      <ul aria-label="Now and next">
        {out ? (
          <RenterRentalRow rental={out} clock={props.clock} />
        ) : (
          <li className={QUIET_LINE_CLASSES}>
            {renting.rental ? "Not renting." : `Not renting. ${renting.words}.`}
          </li>
        )}
        {next ? (
          <RenterRentalRow lead="Next booking:" rental={next} clock={props.clock} />
        ) : (
          <li className={QUIET_LINE_CLASSES}>Next booking: none.</li>
        )}
      </ul>
    </SectionCard>
  );
}

async function LatestNoteCard({ renter, user }: { renter: RenterDetail; user: SignedInUser }) {
  const [latest] = await listNotes(appDb, user.operatorId, renter.id);
  return (
    <SectionCard
      heading="Latest note"
      aside={<SectionLink href={RENTER_TAB_LINKS.href(renter.id, "notes")}>All notes</SectionLink>}
    >
      {latest ? (
        <div className="flex flex-col gap-1 border-t py-3">
          <p className="text-sm break-words whitespace-pre-wrap">{latest.body}</p>
          <p className="text-muted-foreground text-xs">
            {formatDateTimeInTimeZone(latest.writtenAt, user.operatorTimezone)} · {latest.writtenBy}
          </p>
        </div>
      ) : (
        <p className={QUIET_LINE_CLASSES}>No notes yet.</p>
      )}
    </SectionCard>
  );
}

function ContactLine(props: { label: string; value: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-2">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-muted-foreground text-xs">{props.label}</span>
        <span className="text-sm font-bold break-all">{props.value}</span>
      </span>
      <span className="flex">{props.children}</span>
    </li>
  );
}

/** Their phone and email, each a tap from the phone's own app. */
function ContactCard({ renter }: { renter: RenterDetail }) {
  return (
    <SectionCard
      heading="Contact"
      aside={
        <SectionLink href={RENTER_TAB_LINKS.href(renter.id, "details")}>All details</SectionLink>
      }
    >
      <ul aria-label="Contact">
        {renter.phone ? (
          <ContactLine label="Phone" value={renter.phone}>
            <a href={callHref(renter.phone)} className={CONTACT_LINK_CLASSES}>
              Call
            </a>
            <a href={textHref(renter.phone)} className={CONTACT_LINK_CLASSES}>
              Text
            </a>
          </ContactLine>
        ) : null}
        {renter.email ? (
          <ContactLine label="Email" value={renter.email}>
            <a href={emailHref(renter.email)} className={CONTACT_LINK_CLASSES}>
              Email
            </a>
          </ContactLine>
        ) : null}
        {!renter.phone && !renter.email ? (
          <li className={QUIET_LINE_CLASSES}>No phone or email yet.</li>
        ) : null}
      </ul>
    </SectionCard>
  );
}

const LICENCE_BADGES: Readonly<Record<ExpiryStatus, { text: string; tone: BadgeTone }>> = {
  none: { text: "Not on file", tone: "attention" },
  current: { text: "Current", tone: "good" },
  due_soon: { text: "Due soon", tone: "attention" },
  expired: { text: "Expired", tone: "danger" },
};

/** "Front and back on file", or which side is missing. */
function scansText(scans: { front: unknown; back: unknown }): string {
  if (scans.front && scans.back) {
    return "Front and back on file. They open only from the Licence tab, and every opening is logged.";
  }
  if (scans.front || scans.back) {
    return `Only the ${scans.front ? "front" : "back"} is on file. Add the other on the Licence tab.`;
  }
  return "No licence photos on file.";
}

/** The licence's class, type, state and expiry: never its number, never its photos (rule 8). */
function LicenceCard(props: {
  renter: RenterDetail;
  data: RenterPageData;
  scans: { front: unknown; back: unknown };
}) {
  const { renter, data, scans } = props;
  const badge = LICENCE_BADGES[renter.licenceExpiresOn ? data.licenceStatus : "none"];
  const kind =
    renter.licenceType && renter.licenceClass
      ? [
          LICENCE_TYPE_LABELS[renter.licenceType],
          licenceIssuedInText(renter.licenceIssuedIn, renter.licenceCountry),
          LICENCE_CLASS_LABELS[renter.licenceClass],
        ]
          .filter(Boolean)
          .join(" · ")
      : "No licence on file";
  return (
    <SectionCard
      heading="Licence"
      aside={<SectionLink href={RENTER_TAB_LINKS.href(renter.id, "licence")}>Licence</SectionLink>}
    >
      <ul aria-label="Licence">
        <li className="flex items-center gap-3 border-t py-2">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-bold">{kind}</span>
            {renter.licenceExpiresOn ? (
              <span className="text-muted-foreground text-sm">
                {data.licenceStatus === "expired" ? "Expired" : "Expires"}{" "}
                {formatCalendarDate(renter.licenceExpiresOn)}
              </span>
            ) : null}
          </span>
          <Badge tone={badge.tone}>{badge.text}</Badge>
        </li>
        <li className={QUIET_LINE_CLASSES}>{scansText(scans)}</li>
      </ul>
    </SectionCard>
  );
}

/**
 * One Renter's Overview (7 Nov 2026 look): anything to do first (details
 * still needed, a shared phone or email), then their money, the car they
 * have and their latest note on the left; on a computer, how to reach them,
 * their licence and their details form beside them.
 */
export async function RenterOverviewTab(props: {
  renter: RenterDetail;
  data: RenterPageData;
  user: SignedInUser;
  clock: RentalClock;
}) {
  const { renter, data, user } = props;
  const [sharedContacts, scans] = await Promise.all([
    findRentersSharingContact(appDb, user.operatorId, renter),
    listLicenceScans(appDb, user.operatorId, renter.id),
  ]);
  return (
    <>
      <StillNeededCard
        renter={renter}
        isEditable={renter.archivedAt === null}
        hasBothLicenceScans={scans.front !== null && scans.back !== null}
        today={data.today}
      />
      <SharedContactNote contacts={sharedContacts} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <MoneyCard renter={renter} data={data} />
          <NowCard renter={renter} data={data} clock={props.clock} />
          <LatestNoteCard renter={renter} user={user} />
        </div>
        <div className="flex flex-col gap-4">
          <ContactCard renter={renter} />
          <LicenceCard renter={renter} data={data} scans={scans} />
          {renter.archivedAt ? null : <DetailsLinkCard renter={renter} user={user} />}
        </div>
      </div>
    </>
  );
}
