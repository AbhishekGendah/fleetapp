import {
  ageOn,
  DETAIL_NEEDED_LABELS,
  detailsStillNeeded,
  formatCalendarDate,
  todayInTimeZone,
} from "@fleetapp/core";
import { ACTIVITY_ENTITY_TYPES } from "@fleetapp/db/schema";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";
import { TabLinks } from "@fleetapp/ui/tab-links";
import { Archive, ArchiveRestore, History, Pencil, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { HistoryCard } from "../../../components/history-card";
import { appDb } from "../../../lib/app-db";
import { editRenterPath, renterPath, RENTERS_PATH } from "../../../lib/paths";
import { requireUser, type SignedInUser } from "../../../lib/require-user";
import { renterStatusFormValues } from "../../../lib/renters/renter-input";
import {
  describeRenterValue,
  RENTER_FIELD_LABELS,
  renterFieldLabel,
} from "../../../lib/renters/renter-labels";
import {
  findRentersSharingContact,
  type RenterDetail,
  type SharedContact,
} from "../../../lib/renters/renter-queries";
import { AppShell } from "../../app-shell";
import { RenterStatusBadge } from "../renter-status-badge";
import { changeRenterStatusAction, setRenterArchivedAction } from "./actions";
import { loadRenterOrNotFound } from "./load-renter";
import { RenterStatusForm } from "./status-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABS = [
  { key: "details", label: "Details", icon: UserRound },
  { key: "log", label: "Log", icon: History },
] as const satisfies readonly { key: string; label: string; icon: LucideIcon }[];
type TabKey = (typeof TABS)[number]["key"];
const TAB_PARAM = "tab";
const NOT_GIVEN = "Not given";

function chosenTab(value: string | string[] | undefined): TabKey {
  return TABS.find((tab) => tab.key === value)?.key ?? "details";
}

function tabHref(renterId: string, tab: TabKey): string {
  return tab === "details" ? renterPath(renterId) : `${renterPath(renterId)}?${TAB_PARAM}=${tab}`;
}

function StillNeededCard({ renter, isEditable }: { renter: RenterDetail; isEditable: boolean }) {
  const missing = detailsStillNeeded({
    dateOfBirth: renter.dateOfBirth,
    residentialAddress: renter.residentialAddress,
    // TODO(Renters part 2): from the licence and its scans, once they can be added.
    hasLicence: true,
    hasBothLicenceScans: true,
  });
  if (missing.length === 0) {
    return null;
  }
  return (
    <Card className="border-attention/40">
      <CardHeader>
        <CardTitle>Still needed before renting</CardTitle>
        <CardDescription>Rentals will not start until these are on file.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="list-disc pl-5 text-sm">
          {missing.map((detail) => (
            <li key={detail}>{DETAIL_NEEDED_LABELS[detail]}</li>
          ))}
        </ul>
        {isEditable ? (
          <Button asChild className="w-full sm:w-auto sm:self-start">
            <Link href={editRenterPath(renter.id)}>
              <Pencil aria-hidden />
              Add them
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function sharedWhat(contact: SharedContact): string {
  return [contact.sharesPhone ? "phone" : null, contact.sharesEmail ? "email" : null]
    .filter(Boolean)
    .join(" and ");
}

/** Maybe the same person entered twice, maybe family: a note, never a block. */
function SharedContactNote({ contacts }: { contacts: readonly SharedContact[] }) {
  if (contacts.length === 0) {
    return null;
  }
  return (
    <Card className="border-attention/40">
      <CardContent className="flex flex-col gap-2 pt-4 text-sm sm:pt-6">
        <p className="text-attention font-medium">
          Another Renter has the same phone or email. Check it is not the same person entered twice.
        </p>
        <ul className="flex flex-col gap-1">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <Link
                href={renterPath(contact.id)}
                className="text-teal inline-flex min-h-11 items-center font-semibold hover:underline"
              >
                {contact.fullName}
                {contact.isArchived ? " (archived)" : ""}: same {sharedWhat(contact)} →
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function dateOfBirthText(dateOfBirth: string | null, today: string): string {
  return dateOfBirth
    ? `${formatCalendarDate(dateOfBirth)} (age ${ageOn(dateOfBirth, today)})`
    : NOT_GIVEN;
}

function DetailsCard({ renter, today }: { renter: RenterDetail; today: string }) {
  const lines: readonly [string, string][] = [
    [RENTER_FIELD_LABELS.fullName, renter.fullName],
    [RENTER_FIELD_LABELS.preferredName, renter.preferredName ?? NOT_GIVEN],
    [RENTER_FIELD_LABELS.phone, renter.phone ?? NOT_GIVEN],
    [RENTER_FIELD_LABELS.email, renter.email ?? NOT_GIVEN],
    [RENTER_FIELD_LABELS.dateOfBirth, dateOfBirthText(renter.dateOfBirth, today)],
    [RENTER_FIELD_LABELS.residentialAddress, renter.residentialAddress ?? NOT_GIVEN],
    [
      RENTER_FIELD_LABELS.postalAddress,
      renter.postalAddress ?? (renter.residentialAddress ? "Same as home" : NOT_GIVEN),
    ],
    [
      RENTER_FIELD_LABELS.emergencyContactName,
      [
        renter.emergencyContactName,
        renter.emergencyContactRelationship && `(${renter.emergencyContactRelationship})`,
        renter.emergencyContactPhone,
      ]
        .filter(Boolean)
        .join(" ") || NOT_GIVEN,
    ],
  ];
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Details</CardTitle>
        {renter.archivedAt ? null : (
          <Button asChild variant="outline">
            <Link href={editRenterPath(renter.id)}>
              <Pencil aria-hidden />
              Edit
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          {lines.map(([label, value]) => (
            <div key={label} className="flex flex-col sm:contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

async function DetailsTab({ renter, user }: { renter: RenterDetail; user: SignedInUser }) {
  const isArchived = renter.archivedAt !== null;
  const today = todayInTimeZone(new Date(), user.operatorTimezone);
  const sharedContacts = await findRentersSharingContact(appDb, user.operatorId, renter);
  return (
    <>
      <StillNeededCard renter={renter} isEditable={!isArchived} />
      <SharedContactNote contacts={sharedContacts} />
      <DetailsCard renter={renter} today={today} />
      {isArchived ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>
              Do not rent stays with your business: no other Operator ever sees it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RenterStatusForm
              initialValues={renterStatusFormValues(renter)}
              action={changeRenterStatusAction.bind(null, renter.id)}
            />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{isArchived ? "Archived" : "Archive"}</CardTitle>
          <CardDescription>
            {isArchived
              ? "Hidden from your list and read-only. Restore to change anything."
              : "Hides the Renter from your list. Nothing is deleted, and you can restore them."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionButton
            action={setRenterArchivedAction.bind(null, renter.id, !isArchived)}
            label={isArchived ? "Restore this Renter" : "Archive this Renter"}
            pendingLabel={isArchived ? "Restoring…" : "Archiving…"}
            icon={isArchived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          />
        </CardContent>
      </Card>
    </>
  );
}

/** One Renter: their details and status, and their Log. Later phases add rentals, payments and fines. */
export default async function RenterPage(props: {
  params: Promise<{ renterId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [{ renterId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const renter = await loadRenterOrNotFound(user, renterId);
  const tab = chosenTab(searchParams[TAB_PARAM]);

  return (
    <AppShell user={user}>
      <PageHeader
        backHref={RENTERS_PATH}
        backLabel="Renters"
        title={renter.fullName}
        aside={<RenterStatusBadge status={renter.status} isArchived={renter.archivedAt !== null} />}
      />
      {renter.preferredName && renter.preferredName !== renter.fullName ? (
        <p className="text-muted-foreground -mt-2 text-sm">Goes by {renter.preferredName}</p>
      ) : null}
      <TabLinks
        label="Renter sections"
        tabs={TABS.map((item) => ({
          href: tabHref(renter.id, item.key),
          label: item.label,
          isCurrent: item.key === tab,
          icon: <item.icon aria-hidden />,
        }))}
      />
      {tab === "details" ? <DetailsTab renter={renter} user={user} /> : null}
      {tab === "log" ? (
        <HistoryCard
          user={user}
          subjects={[{ entityType: ACTIVITY_ENTITY_TYPES.renter, entityIds: [renter.id] }]}
          fieldLabel={renterFieldLabel}
          describeValue={describeRenterValue}
        />
      ) : null}
    </AppShell>
  );
}
