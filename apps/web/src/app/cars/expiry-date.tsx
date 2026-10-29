import { formatCalendarDate, type ExpiryStatus } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";

/** An expiry date with a badge when it needs attention: rego, insurance, later licences. */
export function ExpiryDate({ date, status }: { date: string | null; status: ExpiryStatus }) {
  if (!date) {
    return <Badge>None</Badge>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {formatCalendarDate(date)}
      {status === "due_soon" ? <Badge tone="attention">Due soon</Badge> : null}
      {status === "expired" ? <Badge tone="danger">Expired</Badge> : null}
    </span>
  );
}
