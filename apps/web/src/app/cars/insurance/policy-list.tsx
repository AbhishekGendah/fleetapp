import { formatPremium, INSURANCE_COVER_TYPE_LABELS, type ExpiryStatus } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import type { DataListDefinition } from "@fleetapp/ui/data-list";

import {
  POLICY_ARCHIVED_FILTER_VALUE,
  POLICY_SHOW_FILTER_KEY,
  type PolicySummary,
} from "../../../lib/vehicles/paperwork-queries";
import { ExpiryDate } from "../expiry-date";

/** A policy with its end date's badge worked out for today. */
export type PolicyListRow = PolicySummary & { endsStatus: ExpiryStatus };

/** The insurance list: searched, sorted and paged by the database (`POLICY_LIST_RULES`). */
export const POLICY_LIST: DataListDefinition<PolicyListRow> = {
  columns: [
    {
      key: "insurer",
      label: "Insurer",
      isCardTitle: true,
      isSortable: true,
      exportValue: (policy) => policy.insurer,
    },
    { key: "policyNumber", label: "Policy number", exportValue: (policy) => policy.policyNumber },
    {
      key: "cover",
      label: "Cover",
      exportValue: (policy) => INSURANCE_COVER_TYPE_LABELS[policy.coverType],
    },
    {
      key: "endsOn",
      label: "Ends",
      isSortable: true,
      exportValue: (policy) => policy.endsOn,
      render: (policy) =>
        policy.archivedAt ? (
          <Badge>Archived</Badge>
        ) : (
          <ExpiryDate date={policy.endsOn} status={policy.endsStatus} />
        ),
    },
    { key: "cars", label: "Cars", isSortable: true, exportValue: (policy) => policy.carCount },
    {
      key: "premium",
      label: "Premium",
      exportValue: (policy) => formatPremium(policy.costCents, policy.paymentFrequency),
    },
  ],
  filters: [
    {
      key: POLICY_SHOW_FILTER_KEY,
      label: "Show",
      options: [{ value: POLICY_ARCHIVED_FILTER_VALUE, label: "Archived" }],
    },
  ],
  defaultSort: { column: "endsOn", direction: "asc" },
};
