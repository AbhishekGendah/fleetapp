import { AUSTRALIAN_LOCALE, VEHICLE_STATUS_LABELS, VEHICLE_STATUSES } from "@fleetapp/core";
import type { DataListDefinition } from "@fleetapp/ui/data-list";

import {
  ARCHIVED_FILTER_VALUE,
  STATUS_FILTER_KEY,
  type VehicleSummary,
} from "../../lib/vehicles/vehicle-queries";
import type { WithExpiryStatuses } from "../../lib/vehicles/expiry-columns";
import { ExpiryDate } from "./expiry-date";
import { VehicleStatusBadge } from "./vehicle-status-badge";

function carName(vehicle: VehicleSummary): string {
  return [vehicle.make, vehicle.model, vehicle.variant].filter(Boolean).join(" ");
}

export function formatKilometres(kilometres: number): string {
  return `${kilometres.toLocaleString(AUSTRALIAN_LOCALE)} km`;
}

/**
 * The cars list: one definition of its columns for the screen (table or
 * cards) and both exports. Searched, sorted and paged by the database
 * (`VEHICLE_LIST_RULES`), so a fleet of any size loads one page at a time.
 */
export type CarListRow = WithExpiryStatuses<VehicleSummary>;

export const CAR_LIST: DataListDefinition<CarListRow> = {
  columns: [
    {
      key: "rego",
      label: "Rego",
      isCardTitle: true,
      isSortable: true,
      exportValue: (vehicle) => vehicle.rego,
    },
    { key: "state", label: "State", exportValue: (vehicle) => vehicle.regoState },
    { key: "car", label: "Car", isSortable: true, exportValue: carName },
    { key: "year", label: "Year", isSortable: true, exportValue: (vehicle) => vehicle.year },
    { key: "colour", label: "Colour", exportValue: (vehicle) => vehicle.colour },
    {
      key: "kilometres",
      label: "Odometer",
      isSortable: true,
      exportValue: (vehicle) => vehicle.currentKilometres,
      render: (vehicle) =>
        vehicle.currentKilometres === null
          ? "Not recorded"
          : formatKilometres(vehicle.currentKilometres),
    },
    {
      key: "regoExpires",
      label: "Rego",
      isSortable: true,
      exportValue: (vehicle) => vehicle.regoExpiresOn,
      render: (vehicle) => <ExpiryDate date={vehicle.regoExpiresOn} status={vehicle.regoStatus} />,
    },
    {
      key: "insuranceEnds",
      label: "Insurance",
      isSortable: true,
      exportValue: (vehicle) => vehicle.insuranceEndsOn,
      render: (vehicle) => (
        <ExpiryDate date={vehicle.insuranceEndsOn} status={vehicle.insuranceStatus} />
      ),
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
  ],
  filters: [
    {
      key: STATUS_FILTER_KEY,
      label: "Status",
      options: [
        ...VEHICLE_STATUSES.map((status) => ({
          value: status,
          label: VEHICLE_STATUS_LABELS[status],
        })),
        { value: ARCHIVED_FILTER_VALUE, label: "Archived" },
      ],
    },
  ],
  defaultSort: { column: "rego", direction: "asc" },
};
