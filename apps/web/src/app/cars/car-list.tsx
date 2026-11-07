import { formatKilometres, VEHICLE_STATUS_LABELS } from "@fleetapp/core";
import type { DataListDefinition } from "@fleetapp/ui/data-list";
import { InlineRecordLink, RowLink } from "@fleetapp/ui/row-link";
import Link from "next/link";

import { CAR_LIST_FILTER_LABELS, CAR_LIST_FILTERS } from "../../lib/vehicles/car-list-filters";
import { isInFleet, type CarListRow } from "../../lib/vehicles/car-list-rows";
import { carNowShortText, type CarNow } from "../../lib/vehicles/car-now";
import { STATUS_FILTER_KEY, type VehicleSummary } from "../../lib/vehicles/vehicle-queries";
import { carPath, renterPath } from "../../lib/paths";
import { ExpiryDate, RegoExpiry } from "./expiry-date";
import { VehicleStatusBadge } from "./vehicle-status-badge";

/** What an export shows for a car on a rego direct debit, which has no expiry. */
const REGO_DIRECT_DEBIT_EXPORT = "Direct debit";
const NOT_RECORDED = "Not recorded";

function carName(vehicle: VehicleSummary): string {
  return [vehicle.make, vehicle.model, vehicle.variant].filter(Boolean).join(" ");
}

/** "Toyota Corolla · 2022 · white", under the rego. */
function carLine(vehicle: VehicleSummary): string {
  return [`${vehicle.make} ${vehicle.model}`, vehicle.year, vehicle.colour?.toLowerCase()]
    .filter(Boolean)
    .join(" · ");
}

function odometerText(vehicle: VehicleSummary): string {
  return vehicle.currentKilometres === null
    ? NOT_RECORDED
    : formatKilometres(vehicle.currentKilometres);
}

/** The rego, bold teal: the row's own link, opening the car from anywhere on the row. */
function RegoLink({ vehicle }: { vehicle: VehicleSummary }) {
  return (
    <RowLink asChild className="text-teal hover:text-primary font-extrabold">
      <Link
        href={carPath(vehicle.id)}
        aria-label={`${vehicle.rego}, ${vehicle.make} ${vehicle.model}`}
      >
        {vehicle.rego}
      </Link>
    </RowLink>
  );
}

function RenterLink({ renterId, name }: { renterId: string; name: string }) {
  return (
    <InlineRecordLink asChild>
      <Link href={renterPath(renterId)}>{name}</Link>
    </InlineRecordLink>
  );
}

/** The Now column: who has the car (their name opens them) or what it is doing. */
function NowWords({ now }: { now: CarNow | null }) {
  if (!now) {
    return null;
  }
  switch (now.kind) {
    case "with_renter":
      return (
        <span>
          <RenterLink renterId={now.rental.renterId} name={now.rental.renterName} />, {now.words}
        </span>
      );
    case "booked":
      return (
        <span>
          Booked by <RenterLink renterId={now.rental.renterId} name={now.rental.renterName} />,{" "}
          {now.day}
        </span>
      );
    case "idle_then_booked":
      return (
        <span>
          {now.idle} · booked by{" "}
          <RenterLink renterId={now.rental.renterId} name={now.rental.renterName} />, {now.day}
        </span>
      );
    case "plain":
      return <span>{now.words}</span>;
  }
}

/**
 * A car's card on a phone (7 Nov 2026 look): rego and status on top, the car,
 * then what it is doing and its paperwork if that needs a look (else the
 * odometer). One tap anywhere opens the car.
 */
export function CarCard({ vehicle }: { vehicle: CarListRow }) {
  return (
    <>
      <span className="flex items-start justify-between gap-2">
        <RegoLink vehicle={vehicle} />
        <VehicleStatusBadge status={vehicle.status} isArchived={vehicle.archivedAt !== null} />
      </span>
      <span className="text-muted-foreground text-sm">
        {vehicle.make} {vehicle.model}
      </span>
      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <span>{carNowShortText(vehicle.now)}</span>
        {vehicle.paperworkAlert ? (
          <span className="text-attention font-bold">{vehicle.paperworkAlert}</span>
        ) : (
          <span className="text-muted-foreground tabular-nums">{odometerText(vehicle)}</span>
        )}
      </span>
    </>
  );
}

/**
 * The cars list (docs/plans/look-and-feel.md, "Cars and Renters pages"): one
 * definition of its columns for the screen (table or cards) and both
 * exports, which keep the state, make and model, year and colour as columns
 * of their own. Searched, sorted and paged by the database
 * (`VEHICLE_LIST_RULES`), so a fleet of any size loads one page at a time.
 */
export const CAR_LIST: DataListDefinition<CarListRow> = {
  columns: [
    {
      key: "rego",
      label: "Car",
      isCardTitle: true,
      isSortable: true,
      exportValue: (vehicle) => vehicle.rego,
      render: (vehicle) => (
        <span className="flex flex-col">
          <RegoLink vehicle={vehicle} />
          <span className="text-muted-foreground text-xs">{carLine(vehicle)}</span>
        </span>
      ),
    },
    {
      key: "state",
      label: "State",
      isOnlyInExports: true,
      exportValue: (vehicle) => vehicle.regoState,
    },
    { key: "car", label: "Make and model", isOnlyInExports: true, exportValue: carName },
    { key: "year", label: "Year", isOnlyInExports: true, exportValue: (vehicle) => vehicle.year },
    {
      key: "colour",
      label: "Colour",
      isOnlyInExports: true,
      exportValue: (vehicle) => vehicle.colour,
    },
    {
      key: "status",
      label: "Status",
      isSortable: true,
      exportValue: (vehicle) =>
        vehicle.archivedAt ? "Archived" : VEHICLE_STATUS_LABELS[vehicle.status],
      render: (vehicle) => (
        <VehicleStatusBadge status={vehicle.status} isArchived={vehicle.archivedAt !== null} />
      ),
    },
    {
      key: "now",
      label: "Now",
      isSortable: true,
      exportValue: (vehicle) => vehicle.nowText,
      render: (vehicle) => <NowWords now={vehicle.now} />,
    },
    {
      key: "regoExpires",
      label: "Rego",
      isSortable: true,
      exportValue: (vehicle) =>
        vehicle.isRegoOnDirectDebit ? REGO_DIRECT_DEBIT_EXPORT : vehicle.regoExpiresOn,
      render: (vehicle) => (
        <RegoExpiry
          isOnDirectDebit={vehicle.isRegoOnDirectDebit}
          date={vehicle.regoExpiresOn}
          status={vehicle.regoStatus}
          isNeeded={isInFleet(vehicle)}
        />
      ),
    },
    {
      key: "insuranceEnds",
      label: "Insurance",
      isSortable: true,
      exportValue: (vehicle) => vehicle.insuranceEndsOn,
      render: (vehicle) => (
        <ExpiryDate
          date={vehicle.insuranceEndsOn}
          status={vehicle.insuranceStatus}
          isNeeded={isInFleet(vehicle)}
        />
      ),
    },
    {
      key: "kilometres",
      label: "Odometer",
      isSortable: true,
      isAlignedEnd: true,
      exportValue: (vehicle) => vehicle.currentKilometres,
      render: odometerText,
    },
  ],
  filters: [
    {
      key: STATUS_FILTER_KEY,
      label: "Status",
      options: CAR_LIST_FILTERS.map((filter) => ({
        value: filter,
        label: CAR_LIST_FILTER_LABELS[filter],
      })),
    },
  ],
  defaultSort: { column: "rego", direction: "asc" },
};
