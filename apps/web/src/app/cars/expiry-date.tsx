import { formatCalendarDate, type ExpiryStatus } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";

/**
 * An expiry date with a badge when it needs attention: rego, insurance, later
 * licences. `isNeeded` says none on file is a problem (a car's rego or
 * insurance), shown red as Missing rather than a grey None.
 */
export function ExpiryDate({
  date,
  status,
  isNeeded = false,
}: {
  date: string | null;
  status: ExpiryStatus;
  isNeeded?: boolean;
}) {
  if (!date) {
    return isNeeded ? <Badge tone="danger">Missing</Badge> : <Badge>None</Badge>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {formatCalendarDate(date)}
      {status === "due_soon" ? <Badge tone="attention">Due soon</Badge> : null}
      {status === "expired" ? <Badge tone="danger">Expired</Badge> : null}
    </span>
  );
}

/** The car's current rego: a running direct debit has no expiry, so it shows as such. */
export function RegoExpiry(props: {
  isOnDirectDebit: boolean;
  date: string | null;
  status: ExpiryStatus;
  isNeeded?: boolean;
}) {
  return props.isOnDirectDebit ? (
    <Badge tone="good">Direct debit</Badge>
  ) : (
    <ExpiryDate date={props.date} status={props.status} isNeeded={props.isNeeded} />
  );
}
