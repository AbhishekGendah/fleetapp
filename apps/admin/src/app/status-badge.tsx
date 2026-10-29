import type { OperatorStatus } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";

import {
  OPERATOR_STATUS_LABELS,
  operatorStatusNeedsAttention,
} from "../lib/operators/status-labels";

export function OperatorStatusBadge({ status }: { status: OperatorStatus }) {
  return (
    <Badge tone={operatorStatusNeedsAttention(status) ? "danger" : "neutral"}>
      {OPERATOR_STATUS_LABELS[status]}
    </Badge>
  );
}
