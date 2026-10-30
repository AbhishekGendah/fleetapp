import { RENTER_STATUS_LABELS, RENTER_STATUSES, renterDisplayName } from "@fleetapp/core";
import type { DataListDefinition } from "@fleetapp/ui/data-list";

import {
  ARCHIVED_FILTER_VALUE,
  STATUS_FILTER_KEY,
  type RenterSummary,
} from "../../lib/renters/renter-queries";
import { RenterStatusBadge } from "./renter-status-badge";

const NOT_GIVEN = "Not given";

/**
 * The Renters list, for the screen and both exports. Exports hold only what
 * is shown here: never a date of birth, address or licence number.
 */
export const RENTER_LIST: DataListDefinition<RenterSummary> = {
  columns: [
    {
      key: "name",
      label: "Name",
      isCardTitle: true,
      isSortable: true,
      exportValue: (renter) => renterDisplayName(renter.fullName, renter.preferredName),
    },
    {
      key: "phone",
      label: "Phone",
      exportValue: (renter) => renter.phone,
      render: (renter) => renter.phone ?? NOT_GIVEN,
    },
    {
      key: "email",
      label: "Email",
      exportValue: (renter) => renter.email,
      render: (renter) => <span className="break-all">{renter.email ?? NOT_GIVEN}</span>,
    },
    {
      key: "status",
      label: "Status",
      isSortable: true,
      exportValue: (renter) =>
        renter.archivedAt ? "Archived" : RENTER_STATUS_LABELS[renter.status],
      render: (renter) => (
        <RenterStatusBadge status={renter.status} isArchived={renter.archivedAt !== null} />
      ),
    },
  ],
  filters: [
    {
      key: STATUS_FILTER_KEY,
      label: "Status",
      options: [
        ...RENTER_STATUSES.map((status) => ({
          value: status,
          label: RENTER_STATUS_LABELS[status],
        })),
        { value: ARCHIVED_FILTER_VALUE, label: "Archived" },
      ],
    },
  ],
  defaultSort: { column: "name", direction: "asc" },
};
