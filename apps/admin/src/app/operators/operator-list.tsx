import { formatFileSize, OPERATOR_STATUSES, operatorDisplayName } from "@fleetapp/core";
import type { InMemoryListRules } from "@fleetapp/core";
import type { DataListDefinition } from "@fleetapp/ui/data-list";

import { formatAdminDateTime } from "../../lib/format";
import type { OperatorSummary } from "../../lib/operators/queries";
import { OPERATOR_STATUS_LABELS } from "../../lib/operators/status-labels";
import { OperatorStatusBadge } from "../status-badge";

/**
 * The admin Operator list: one definition of its columns, used for the
 * screen (table or cards) and for both exports.
 */
export const OPERATOR_LIST: DataListDefinition<OperatorSummary> = {
  columns: [
    {
      key: "operator",
      label: "Operator",
      isCardTitle: true,
      isSortable: true,
      exportValue: operatorDisplayName,
    },
    { key: "user", label: "User", exportValue: (operator) => operator.userEmail ?? "No User" },
    {
      key: "status",
      label: "Status",
      exportValue: (operator) => OPERATOR_STATUS_LABELS[operator.status],
      render: (operator) => <OperatorStatusBadge status={operator.status} />,
    },
    {
      key: "lastSignIn",
      label: "Last sign-in",
      isSortable: true,
      exportValue: (operator) => operator.lastSignedInAt,
      render: (operator) =>
        operator.lastSignedInAt ? formatAdminDateTime(operator.lastSignedInAt) : "Never",
    },
    {
      key: "storage",
      label: "Storage used",
      isSortable: true,
      exportValue: (operator) => operator.storageUsedBytes,
      render: (operator) => formatFileSize(operator.storageUsedBytes),
    },
    {
      key: "created",
      label: "Created",
      isSortable: true,
      exportValue: (operator) => operator.createdAt,
      render: (operator) => formatAdminDateTime(operator.createdAt),
    },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      options: OPERATOR_STATUSES.map((status) => ({
        value: status,
        label: OPERATOR_STATUS_LABELS[status],
      })),
    },
  ],
  defaultSort: { column: "created", direction: "desc" },
};

/**
 * Searched and sorted in memory: there will only ever be dozens of
 * Operators, and their status is worked out from several tables.
 */
export const OPERATOR_LIST_RULES: InMemoryListRules<OperatorSummary> = {
  searchText: (operator) =>
    [operator.legalName, operator.tradingName, operator.userEmail].filter(Boolean).join(" "),
  sortValues: {
    operator: operatorDisplayName,
    lastSignIn: (operator) => operator.lastSignedInAt,
    storage: (operator) => operator.storageUsedBytes,
    created: (operator) => operator.createdAt,
  },
  filterMatches: { status: (operator, status) => operator.status === status },
};
