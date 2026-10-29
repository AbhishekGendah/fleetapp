import { formatFileSize, OPERATOR_STATUSES, operatorDisplayName } from "@fleetapp/core";
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
      sortValue: operatorDisplayName,
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
      sortValue: (operator) => operator.lastSignedInAt,
      exportValue: (operator) => operator.lastSignedInAt,
      render: (operator) =>
        operator.lastSignedInAt ? formatAdminDateTime(operator.lastSignedInAt) : "Never",
    },
    {
      key: "storage",
      label: "Storage used",
      sortValue: (operator) => operator.storageUsedBytes,
      exportValue: (operator) => operator.storageUsedBytes,
      render: (operator) => formatFileSize(operator.storageUsedBytes),
    },
    {
      key: "created",
      label: "Created",
      sortValue: (operator) => operator.createdAt,
      exportValue: (operator) => operator.createdAt,
      render: (operator) => formatAdminDateTime(operator.createdAt),
    },
  ],
  searchText: (operator) =>
    [operator.legalName, operator.tradingName, operator.userEmail].filter(Boolean).join(" "),
  filters: [
    {
      key: "status",
      label: "Status",
      options: OPERATOR_STATUSES.map((status) => ({
        value: status,
        label: OPERATOR_STATUS_LABELS[status],
      })),
      matches: (operator, status) => operator.status === status,
    },
  ],
  defaultSort: { column: "created", direction: "desc" },
};
