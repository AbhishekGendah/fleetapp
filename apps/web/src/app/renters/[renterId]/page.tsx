import type { Metadata } from "next";
import { renterFirstName, renterShownName } from "@fleetapp/core";
import { ACTIVITY_ENTITY_TYPES } from "@fleetapp/db/schema";
import { TabLinks } from "@fleetapp/ui/tab-links";

import { HistoryCard } from "../../../components/history-card";
import { appDb } from "../../../lib/app-db";
import { NOTICE_PARAM } from "../../../lib/privacy/send-privacy-notice";
import { TAB_PARAM } from "../../../lib/record-tabs";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import { listRenterLinkIds } from "../../../lib/renter-links/details-links";
import { requireUser, type SignedInUser } from "../../../lib/require-user";
import { listRenterFileIds } from "../../../lib/renters/licence-scans";
import {
  businessRenterFieldLabel,
  describeRenterValue,
  renterFieldLabel,
} from "../../../lib/renters/renter-labels";
import { listDriverLinkIds } from "../../../lib/renters/organisation-driver-queries";
import { listNoteIds } from "../../../lib/renters/notes";
import type { RenterDetail } from "../../../lib/renters/renter-queries";
import { AppShell } from "../../app-shell";
import { RecordRentalsCard } from "../../rentals/record-rentals-card";
import { BusinessDetailsTab } from "./business-details-tab";
import { BusinessOverviewTab } from "./business-overview-tab";
import { loadBusinessPageData, type BusinessPageData } from "./business-page-data";
import { BusinessStrip } from "./business-strip";
import { DetailsTab } from "./details-tab";
import { DriversTab } from "./drivers-tab";
import { LicenceTab } from "./licence-tab";
import { loadRenterOrNotFound } from "./load-renter";
import { MoneyTab } from "./money-tab";
import { NotesTab } from "./notes-tab";
import { NoticeNotSent } from "./notice-not-sent";
import { RenterOverviewTab } from "./overview-tab";
import { loadRenterPageData, type RenterPageData } from "./renter-page-data";
import { RenterStrip } from "./renter-strip";
import {
  BUSINESS_TAB_LINKS,
  BUSINESS_TABS,
  RENTER_TAB_LINKS,
  RENTER_TABS,
  type BusinessTabKey,
  type RenterTabKey,
} from "./renter-tabs";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Renter" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything that happened to the Renter: their record, scans and photos
 * sent through their links, notes and links. Loaded only when the tab opens.
 */
async function RenterLogTab({ renter, user }: { renter: RenterDetail; user: SignedInUser }) {
  const linkIds = await listRenterLinkIds(appDb, user.operatorId, renter.id);
  const [fileIds, noteIds, driverLinkIds] = await Promise.all([
    listRenterFileIds(appDb, user.operatorId, renter.id, linkIds),
    listNoteIds(appDb, user.operatorId, renter.id),
    listDriverLinkIds(appDb, user.operatorId, renter.id),
  ]);
  return (
    <HistoryCard
      user={user}
      subjects={[
        { entityType: ACTIVITY_ENTITY_TYPES.renter, entityIds: [renter.id] },
        { entityType: ACTIVITY_ENTITY_TYPES.file, entityIds: fileIds },
        { entityType: ACTIVITY_ENTITY_TYPES.renterNote, entityIds: noteIds },
        { entityType: ACTIVITY_ENTITY_TYPES.renterLink, entityIds: linkIds },
        { entityType: ACTIVITY_ENTITY_TYPES.organisationDriver, entityIds: driverLinkIds },
      ]}
      fieldLabel={renter.kind === "organisation" ? businessRenterFieldLabel : renterFieldLabel}
      describeValue={describeRenterValue}
    />
  );
}

/** The tab chosen in the address: what each holds (docs/plans/look-and-feel.md). */
function ChosenTab(props: {
  tab: RenterTabKey;
  renter: RenterDetail;
  user: SignedInUser;
  data: RenterPageData;
  clock: RentalClock;
}) {
  const { tab, renter, user, data } = props;
  switch (tab) {
    case "overview":
      return <RenterOverviewTab renter={renter} data={data} user={user} clock={props.clock} />;
    case "rentals":
      return (
        <RecordRentalsCard
          user={user}
          scope={{ renterId: renter.id }}
          heading={`${renterFirstName(renter.fullName, renter.preferredName)}'s rentals`}
          newRentalLabel="New rental"
          isNewRentalHidden={renter.archivedAt !== null}
        />
      );
    case "money":
      return <MoneyTab renterId={renter.id} user={user} />;
    case "details":
      return <DetailsTab renter={renter} user={user} />;
    case "licence":
      return <LicenceTab renter={renter} user={user} expiry={data.licenceExpiry} />;
    case "notes":
      return <NotesTab renter={renter} user={user} />;
    case "log":
      return <RenterLogTab renter={renter} user={user} />;
  }
}

/** A business's tab chosen in the address (7 Nov 2026 mockups). */
async function ChosenBusinessTab(props: {
  tab: BusinessTabKey;
  renter: RenterDetail;
  user: SignedInUser;
  data: RenterPageData;
  business: BusinessPageData;
  clock: RentalClock;
}) {
  const { tab, renter, user, data, business } = props;
  switch (tab) {
    case "overview":
      return (
        <BusinessOverviewTab
          renter={renter}
          data={data}
          business={business}
          user={user}
          clock={props.clock}
        />
      );
    case "drivers":
      return (
        <DriversTab renter={renter} business={business} expiry={data.licenceExpiry} user={user} />
      );
    case "rentals":
      return (
        <RecordRentalsCard
          user={user}
          scope={{ renterId: renter.id }}
          heading={`${renterShownName(renter)}'s rentals`}
          newRentalLabel="New rental"
          // Renting to a business comes with its driver picker and contract (plan slice 3).
          isNewRentalHidden
        />
      );
    case "money":
      return (
        <MoneyTab
          renterId={renter.id}
          user={user}
          moneyByCar={business.moneyByCar}
          isMoneyByCarCut={business.isMoneyByCarCut}
        />
      );
    case "details":
      return <BusinessDetailsTab renter={renter} user={user} />;
    case "notes":
      return <NotesTab renter={renter} user={user} />;
    case "log":
      return <RenterLogTab renter={renter} user={user} />;
  }
}

/** A business Renter's page: its own strip and tabs, its drivers in place of a licence. */
async function BusinessRenterPage(props: {
  renter: RenterDetail;
  user: SignedInUser;
  searchParams: Record<string, string | string[] | undefined>;
  data: RenterPageData;
  clock: RentalClock;
}) {
  const { renter, user, data, clock } = props;
  const tab = BUSINESS_TAB_LINKS.chosen(props.searchParams[TAB_PARAM]);
  const business = await loadBusinessPageData(renter.id, user, clock, data);
  return (
    <AppShell
      user={user}
      strip={
        <BusinessStrip
          renter={renter}
          data={data}
          driverCount={business.currentDrivers.length}
          clock={clock}
        />
      }
    >
      <NoticeNotSent
        renterName={renter.contactName ?? renter.fullName}
        outcome={props.searchParams[NOTICE_PARAM]}
      />
      <TabLinks
        label="Business sections"
        tabs={BUSINESS_TABS.map((item) => ({
          href: BUSINESS_TAB_LINKS.href(renter.id, item.key),
          label: item.label,
          isCurrent: item.key === tab,
          icon: <item.icon aria-hidden />,
        }))}
      />
      <ChosenBusinessTab
        tab={tab}
        renter={renter}
        user={user}
        data={data}
        business={business}
        clock={clock}
      />
    </AppShell>
  );
}

/**
 * One Renter (docs/plans/look-and-feel.md, "Cars and Renters pages"): the
 * navy strip, then tabs for their Overview, Rentals, Money, Details, Licence,
 * Notes and Log. Their licence number is never shown, nor their licence
 * photos as pictures (Abhi, 7 Nov 2026).
 */
export default async function RenterPage(props: {
  params: Promise<{ renterId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [{ renterId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const renter = await loadRenterOrNotFound(user, renterId);
  const clock: RentalClock = { timeZone: user.operatorTimezone, now: new Date() };
  const data = await loadRenterPageData(renter, user, clock);
  if (renter.kind === "organisation") {
    return (
      <BusinessRenterPage
        renter={renter}
        user={user}
        searchParams={searchParams}
        data={data}
        clock={clock}
      />
    );
  }
  const tab = RENTER_TAB_LINKS.chosen(searchParams[TAB_PARAM]);

  return (
    <AppShell
      user={user}
      strip={<RenterStrip renter={renter} data={data} timeZone={user.operatorTimezone} />}
    >
      <NoticeNotSent renterName={renter.fullName} outcome={searchParams[NOTICE_PARAM]} />
      <TabLinks
        label="Renter sections"
        tabs={RENTER_TABS.map((item) => ({
          href: RENTER_TAB_LINKS.href(renter.id, item.key),
          label: item.label,
          isCurrent: item.key === tab,
          icon: <item.icon aria-hidden />,
        }))}
      />
      <ChosenTab tab={tab} renter={renter} user={user} data={data} clock={clock} />
    </AppShell>
  );
}
