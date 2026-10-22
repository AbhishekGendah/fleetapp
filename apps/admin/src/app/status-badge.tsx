import type { OperatorStatus } from "@fleetapp/core";
import { cn } from "@fleetapp/ui/cn";

import {
  OPERATOR_STATUS_LABELS,
  operatorStatusNeedsAttention,
} from "../lib/operators/status-labels";

export function OperatorStatusBadge({ status }: { status: OperatorStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
        operatorStatusNeedsAttention(status)
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground",
      )}
    >
      {OPERATOR_STATUS_LABELS[status]}
    </span>
  );
}
