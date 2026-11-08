import type { Metadata } from "next";
import { ACTIVITY_ENTITY_TYPES } from "@fleetapp/db/schema";
import { TabLinks } from "@fleetapp/ui/tab-links";

import { appDb } from "../../../lib/app-db";
import { listCarFileIds } from "../../../lib/files/car-files";
import { TAB_PARAM } from "../../../lib/record-tabs";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import { requireUser, type SignedInUser } from "../../../lib/require-user";
import { loadCarCosts } from "../../../lib/vehicles/cost-queries";
import { loadPaperworkIds } from "../../../lib/vehicles/paperwork-queries";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { AppShell } from "../../app-shell";
import { RecordRentalsCard } from "../../rentals/record-rentals-card";
import { CarHistoryCard } from "../car-history-card";
import { loadCarPageData, type CarPageData } from "./car-page-data";
import { CarStrip } from "./car-strip";
import { CAR_TAB_LINKS, CAR_TABS, type CarTabKey } from "./car-tabs";
import { CostsTab } from "./costs-tab";
import { DamageTab } from "./damage-tab";
import { DocumentsTab } from "./documents-tab";
import { loadCarOrNotFound } from "./load-car";
import { OdometerTab } from "./odometer-tab";
import { CarOverviewTab } from "./overview-tab";
import { PaperworkTab } from "./paperwork-tab";
import { PhotosTab } from "./photos-tab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function HistoryTab({ vehicle, user }: { vehicle: VehicleDetail; user: SignedInUser }) {
  const [paperwork, costs, fileIds] = await Promise.all([
    loadPaperworkIds(appDb, user.operatorId, vehicle.id),
    loadCarCosts(appDb, user.operatorId, vehicle.id),
    listCarFileIds(appDb, user.operatorId, vehicle.id),
  ]);
  const { purchaseIds, saleIds, costIds } = costs.historyIds;
  return (
    <CarHistoryCard
      user={user}
      subjects={[
        { entityType: ACTIVITY_ENTITY_TYPES.vehicle, entityIds: [vehicle.id] },
        {
          entityType: ACTIVITY_ENTITY_TYPES.odometerReading,
          entityIds: vehicle.readings.map((reading) => reading.id),
        },
        {
          entityType: ACTIVITY_ENTITY_TYPES.vehicleRegistration,
          entityIds: paperwork.registrationIds,
        },
        // A fleet policy's history includes its other cars: shown, as it is the same policy.
        { entityType: ACTIVITY_ENTITY_TYPES.insurancePolicy, entityIds: paperwork.policyIds },
        { entityType: ACTIVITY_ENTITY_TYPES.vehiclePurchase, entityIds: purchaseIds },
        { entityType: ACTIVITY_ENTITY_TYPES.vehicleSale, entityIds: saleIds },
        { entityType: ACTIVITY_ENTITY_TYPES.vehicleCost, entityIds: costIds },
        { entityType: ACTIVITY_ENTITY_TYPES.file, entityIds: fileIds },
      ]}
    />
  );
}

/** The tab chosen in the address: what each holds (docs/plans/look-and-feel.md). */
function ChosenTab(props: {
  tab: CarTabKey;
  vehicle: VehicleDetail;
  user: SignedInUser;
  data: CarPageData;
  clock: RentalClock;
}) {
  const { tab, vehicle, user } = props;
  switch (tab) {
    case "overview":
      return <CarOverviewTab vehicle={vehicle} data={props.data} clock={props.clock} />;
    case "rentals":
      return (
        <RecordRentalsCard
          user={user}
          scope={{ vehicleId: vehicle.id }}
          heading={`Rentals of ${vehicle.rego}`}
          newRentalLabel="New rental"
          isNewRentalHidden={vehicle.archivedAt !== null}
        />
      );
    case "paperwork":
      return <PaperworkTab vehicle={vehicle} user={user} />;
    case "damage":
      return <DamageTab vehicle={vehicle} user={user} />;
    case "costs":
      return <CostsTab vehicle={vehicle} user={user} />;
    case "photos":
      return <PhotosTab vehicle={vehicle} user={user} />;
    case "documents":
      return <DocumentsTab vehicle={vehicle} user={user} />;
    case "odometer":
      return <OdometerTab vehicle={vehicle} timezone={user.operatorTimezone} />;
    case "log":
      return <HistoryTab vehicle={vehicle} user={user} />;
  }
}

/** The tab is named by the car's rego (review A10-2). */
export async function generateMetadata(props: {
  params: Promise<{ vehicleId: string }>;
}): Promise<Metadata> {
  const user = await requireUser();
  const vehicle = await loadCarOrNotFound(user, (await props.params).vehicleId);
  return { title: vehicle.rego };
}

/**
 * One car (docs/plans/look-and-feel.md, "Cars and Renters pages"): the navy
 * strip, then tabs for its Overview, Rentals, Rego & insurance, Damage,
 * Costs, Photos, Documents, Odometer and Log.
 */
export default async function CarPage(props: {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [{ vehicleId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const vehicle = await loadCarOrNotFound(user, vehicleId);
  const tab = CAR_TAB_LINKS.chosen(searchParams[TAB_PARAM]);
  const clock: RentalClock = { timeZone: user.operatorTimezone, now: new Date() };
  const data = await loadCarPageData(vehicle, user, clock);

  return (
    <AppShell user={user} strip={<CarStrip vehicle={vehicle} data={data} clock={clock} />}>
      <TabLinks
        label="Car sections"
        tabs={CAR_TABS.map((item) => ({
          href: CAR_TAB_LINKS.href(vehicle.id, item.key),
          label: item.label,
          isCurrent: item.key === tab,
          icon: <item.icon aria-hidden />,
        }))}
      />
      <ChosenTab tab={tab} vehicle={vehicle} user={user} data={data} clock={clock} />
    </AppShell>
  );
}
