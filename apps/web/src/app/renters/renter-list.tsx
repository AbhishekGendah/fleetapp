import {
  expiryStatus,
  RENTER_STATUS_LABELS,
  RENTER_STATUSES,
  renterDisplayName,
  type ExpiryStatus,
} from "@fleetapp/core";
import type { DataListDefinition } from "@fleetapp/ui/data-list";

import {
  ARCHIVED_FILTER_VALUE,
  STATUS_FILTER_KEY,
  WAITING_REVIEW_FILTER_VALUE,
  type RenterSummary,
} from "../../lib/renters/renter-queries";
import type { ExpiryContext } from "../../lib/vehicles/expiry-columns";
import { ExpiryDate } from "../cars/expiry-date";
import { RenterStatusBadge, WAITING_REVIEW_LABEL, WaitingReviewBadge } from "./renter-status-badge";

const NOT_GIVEN = "Not given";

export type RenterListRow = RenterSummary & { licenceStatus: ExpiryStatus };

/** Adds each Renter's licence badge: Due soon inside the Operator's window, Expired after. */
export function withLicenceStatuses(
  rows: readonly RenterSummary[],
  context: ExpiryContext,
): RenterListRow[] {
  return rows.map((row) => ({
    ...row,
    licenceStatus: expiryStatus(row.licenceExpiresOn, context.today, context.warningDays),
  }));
}

/**
 * The Renters list, for the screen and both exports. Exports hold only what
 * is shown here: never a date of birth, address or licence number (the
 * licence's expiry date only).
 */
export const RENTER_LIST: DataListDefinition<RenterListRow> = {
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
      key: "licenceExpires",
      label: "Licence",
      isSortable: true,
      exportValue: (renter) => renter.licenceExpiresOn,
      render: (renter) => (
        <ExpiryDate date={renter.licenceExpiresOn} status={renter.licenceStatus} />
      ),
    },
    {
      key: "status",
      label: "Status",
      isSortable: true,
      exportValue: (renter) =>
        renter.archivedAt ? "Archived" : RENTER_STATUS_LABELS[renter.status],
      render: (renter) => (
        <span className="flex flex-wrap gap-1">
          <RenterStatusBadge status={renter.status} isArchived={renter.archivedAt !== null} />
          {renter.isWaitingReview && renter.archivedAt === null ? <WaitingReviewBadge /> : null}
        </span>
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
        { value: WAITING_REVIEW_FILTER_VALUE, label: WAITING_REVIEW_LABEL },
        { value: ARCHIVED_FILTER_VALUE, label: "Archived" },
      ],
    },
  ],
  defaultSort: { column: "name", direction: "asc" },
};
