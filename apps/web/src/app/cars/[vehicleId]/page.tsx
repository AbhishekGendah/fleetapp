import { formatCalendarDate, formatDateTimeInTimeZone, formatKilometres } from "@fleetapp/core";
import { ACTIVITY_ENTITY_TYPES } from "@fleetapp/db/schema";
import { Badge } from "@fleetapp/ui/badge";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { TabLinks } from "@fleetapp/ui/tab-links";
import Link from "next/link";

import { AppShell } from "../../app-shell";
import { appDb } from "../../../lib/app-db";
import { carPath, CARS_PATH, editCarPath } from "../../../lib/paths";
import { loadCarCosts } from "../../../lib/vehicles/cost-queries";
import { loadPaperworkIds } from "../../../lib/vehicles/paperwork-queries";
import { requireUser, type SignedInUser } from "../../../lib/require-user";
import {
  describeVehicleValue,
  VEHICLE_FIELD_LABELS,
  vehicleFieldLabel,
} from "../../../lib/vehicles/vehicle-labels";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { CarHistoryCard } from "../car-history-card";
import { VehicleStatusBadge } from "../vehicle-status-badge";
import { ActionButton } from "@fleetapp/ui/action-button";
import {
  changeStatusAction,
  recordReadingAction,
  setArchivedAction,
  withdrawReadingAction,
} from "./actions";
import { CostsTab } from "./costs-tab";
import { loadCarOrNotFound } from "./load-car";
import { OdometerForm } from "./odometer-form";
import { PaperworkTab } from "./paperwork-tab";
import { StatusForm } from "./status-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABS = [
  { key: "details", label: "Details" },
  { key: "paperwork", label: "Rego & insurance" },
  { key: "costs", label: "Costs" },
  { key: "odometer", label: "Odometer" },
  { key: "log", label: "Log" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const TAB_PARAM = "tab";

function chosenTab(value: string | string[] | undefined): TabKey {
  return TABS.find((tab) => tab.key === value)?.key ?? "details";
}

function tabHref(vehicleId: string, tab: TabKey): string {
  return tab === "details" ? carPath(vehicleId) : `${carPath(vehicleId)}?${TAB_PARAM}=${tab}`;
}

/** The fields shown on the Details tab, in order. */
const DETAIL_FIELDS = [
  "regoState",
  "make",
  "model",
  "variant",
  "year",
  "colour",
  "bodyType",
  "transmission",
  "fuelType",
  "seats",
  "vin",
] as const;

function DetailsTab({ vehicle }: { vehicle: VehicleDetail }) {
  const isArchived = vehicle.archivedAt !== null;
  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle>Details</CardTitle>
          {isArchived ? null : (
            <Button asChild variant="outline" size="sm">
              <Link href={editCarPath(vehicle.id)}>Edit</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
            {DETAIL_FIELDS.map((field) => (
              <div key={field} className="contents">
                <dt className="text-muted-foreground">{VEHICLE_FIELD_LABELS[field]}</dt>
                <dd className="break-words">{describeVehicleValue(field, vehicle[field])}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {isArchived ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>
              Rented is set by the app once rentals are added; choose the rest here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StatusForm
              initialValues={{
                status: vehicle.status,
                statusReason: vehicle.statusReason ?? "",
                statusExpectedBack: vehicle.statusExpectedBack ?? "",
              }}
              action={changeStatusAction.bind(null, vehicle.id)}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isArchived ? "Archived" : "Archive"}</CardTitle>
          <CardDescription>
            {isArchived
              ? "This car is hidden from your list and cannot be changed. Its log is kept."
              : "Hides the car from your list, e.g. once it is sold. Nothing is deleted, and you can restore it."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionButton
            action={setArchivedAction.bind(null, vehicle.id, !isArchived)}
            label={isArchived ? "Restore this car" : "Archive this car"}
            pendingLabel={isArchived ? "Restoring…" : "Archiving…"}
          />
        </CardContent>
      </Card>
    </>
  );
}

function OdometerTab({ vehicle, timezone }: { vehicle: VehicleDetail; timezone: string }) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Readings</CardTitle>
          <CardDescription>
            A reading lower than the last is refused unless the odometer was replaced. Withdraw one
            entered by mistake; it stays on record, crossed out.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {vehicle.archivedAt ? null : (
            <FormDialog triggerLabel="Add a reading" title="Add an odometer reading">
              <OdometerForm action={recordReadingAction.bind(null, vehicle.id)} />
            </FormDialog>
          )}
          {vehicle.readings.length === 0 ? (
            <p className="text-muted-foreground text-sm">No readings yet.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {vehicle.readings.map((reading) => (
                <li
                  key={reading.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div
                    className={
                      reading.withdrawnAt ? "text-muted-foreground line-through" : undefined
                    }
                  >
                    <p className="font-medium">{formatKilometres(reading.kilometres)}</p>
                    <p className="text-muted-foreground text-xs">
                      {formatDateTimeInTimeZone(reading.recordedAt, timezone)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {reading.isDrop ? <Badge tone="attention">Lower than before</Badge> : null}
                    {reading.withdrawnAt ? (
                      <Badge>Withdrawn</Badge>
                    ) : vehicle.archivedAt ? null : (
                      <ActionButton
                        action={withdrawReadingAction.bind(null, vehicle.id, reading.id)}
                        label="Withdraw"
                        pendingLabel="Withdrawing…"
                        variant="ghost"
                        size="sm"
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

async function HistoryTab({ vehicle, user }: { vehicle: VehicleDetail; user: SignedInUser }) {
  const [paperwork, costs] = await Promise.all([
    loadPaperworkIds(appDb, user.operatorId, vehicle.id),
    loadCarCosts(appDb, user.operatorId, vehicle.id),
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
      ]}
    />
  );
}

function CarHeader({ vehicle }: { vehicle: VehicleDetail }) {
  const carName = [vehicle.year, vehicle.make, vehicle.model, vehicle.variant]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <Link
        href={CARS_PATH}
        className="text-teal inline-flex min-h-11 items-center text-sm font-semibold"
      >
        ← All cars
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-primary text-2xl font-extrabold">
          {vehicle.rego}{" "}
          <span className="text-muted-foreground text-base font-semibold">{vehicle.regoState}</span>
        </h1>
        <VehicleStatusBadge status={vehicle.status} isArchived={vehicle.archivedAt !== null} />
      </div>
      <p className="text-muted-foreground -mt-2 text-sm">
        {carName}
        {vehicle.currentKilometres === null
          ? ""
          : ` · ${formatKilometres(vehicle.currentKilometres)}`}
      </p>
      {vehicle.isTransferPending ? (
        <p className="text-attention text-sm font-medium">
          Transfer not lodged yet: fines can still come to you.
        </p>
      ) : null}
      {vehicle.statusExpectedBack && vehicle.statusReason ? (
        <p className="text-attention text-sm">
          {vehicle.statusReason}. Expected back {formatCalendarDate(vehicle.statusExpectedBack)}.
        </p>
      ) : null}
    </>
  );
}

/** One car: its details and status, paperwork, costs, odometer readings and history, each on its own tab. */
export default async function CarPage(props: {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [{ vehicleId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const vehicle = await loadCarOrNotFound(user, vehicleId);
  const tab = chosenTab(searchParams[TAB_PARAM]);

  return (
    <AppShell user={user}>
      <CarHeader vehicle={vehicle} />
      <TabLinks
        label="Car sections"
        tabs={TABS.map((item) => ({
          href: tabHref(vehicle.id, item.key),
          label: item.label,
          isCurrent: item.key === tab,
        }))}
      />

      {tab === "details" ? <DetailsTab vehicle={vehicle} /> : null}
      {tab === "paperwork" ? <PaperworkTab vehicle={vehicle} user={user} /> : null}
      {tab === "costs" ? <CostsTab vehicle={vehicle} user={user} /> : null}
      {tab === "odometer" ? (
        <OdometerTab vehicle={vehicle} timezone={user.operatorTimezone} />
      ) : null}
      {tab === "log" ? <HistoryTab vehicle={vehicle} user={user} /> : null}
    </AppShell>
  );
}
