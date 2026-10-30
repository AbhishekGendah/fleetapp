import {
  expiryStatus,
  formatCalendarDate,
  formatCents,
  isDirectDebitTerm,
  regoTermLabel,
} from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";

import type { ExpiryContext } from "../../../lib/vehicles/expiry-columns";
import { emptyRegoForm } from "../../../lib/vehicles/paperwork-input";
import type { Registration } from "../../../lib/vehicles/paperwork-queries";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import type { Attachment } from "../../../lib/files/attachments";
import { carPath } from "../../../lib/paths";
import { Attachments } from "../attachments";
import { RegoExpiry } from "../expiry-date";
import { RegoForm } from "../rego-form";
import { removeRegoAction, addRegoAction, stopDirectDebitAction } from "./paperwork-actions";
import { StopDirectDebitForm } from "./stop-direct-debit-form";

function isRunningDirectDebit(registration: Registration): boolean {
  return registration.expiresOn === null && registration.directDebitStoppedOn === null;
}

/** Running direct debits first, then fixed terms latest expiry first. */
function inCurrentOrder(registrations: readonly Registration[]): Registration[] {
  return [...registrations].sort((left, right) => {
    if (isRunningDirectDebit(left) !== isRunningDirectDebit(right)) {
      return isRunningDirectDebit(left) ? -1 : 1;
    }
    return (right.expiresOn ?? "").localeCompare(left.expiresOn ?? "");
  });
}

function amountText(registration: Registration): string {
  const amount = formatCents(registration.costCents);
  const gst = registration.gstCents > 0 ? ` incl. ${formatCents(registration.gstCents)} GST` : "";
  return isDirectDebitTerm(registration.termMonths) ? `${amount} a month${gst}` : `${amount}${gst}`;
}

function datesText(registration: Registration): string {
  if (registration.expiresOn !== null) {
    const paid = registration.paidOn ? ` · paid ${formatCalendarDate(registration.paidOn)}` : "";
    return `to ${formatCalendarDate(registration.expiresOn)}${paid}`;
  }
  const started = registration.paidOn ? `started ${formatCalendarDate(registration.paidOn)}` : "";
  const stopped = registration.directDebitStoppedOn
    ? `stopped ${formatCalendarDate(registration.directDebitStoppedOn)}`
    : "running";
  return [started, stopped].filter(Boolean).join(", ");
}

function RegoLine(props: {
  vehicle: VehicleDetail;
  registration: Registration;
  today: string;
  attachments: readonly Attachment[];
}) {
  const { vehicle, registration } = props;
  const isEditable = vehicle.archivedAt === null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
      <div>
        <p className="font-medium">
          {registration.state}, {regoTermLabel(registration.termMonths).toLowerCase()},{" "}
          {datesText(registration)}
        </p>
        <p className="text-muted-foreground text-xs">{amountText(registration)}</p>
        <Attachments
          target={{ kind: "registration", id: registration.id }}
          attachments={props.attachments}
          isEditable={isEditable}
          pagePath={carPath(vehicle.id)}
        />
      </div>
      {isEditable ? (
        <div className="flex flex-wrap gap-2">
          {isRunningDirectDebit(registration) ? (
            <FormDialog triggerLabel="Stop direct debit" title="Stop the direct debit">
              <StopDirectDebitForm
                today={props.today}
                action={stopDirectDebitAction.bind(null, vehicle.id, registration.id)}
              />
            </FormDialog>
          ) : null}
          <ActionButton
            action={removeRegoAction.bind(null, vehicle.id, registration.id)}
            label="Remove"
            pendingLabel="Removing…"
            variant="ghost"
            size="sm"
          />
        </div>
      ) : null}
    </li>
  );
}

/** The car's rego: its current rego, every renewal, and adding one. */
export function RegoCard(props: {
  vehicle: VehicleDetail;
  registrations: readonly Registration[];
  expiry: ExpiryContext;
  isGstRegistered: boolean;
  attachments: readonly Attachment[];
}) {
  const { vehicle, expiry } = props;
  const registrations = inCurrentOrder(props.registrations);
  const current = registrations[0] ?? null;
  const isOnDirectDebit = current !== null && isRunningDirectDebit(current);
  // A new fixed term runs on from the current expiry, or from today if there is none.
  const latestExpiry = isOnDirectDebit ? null : (current?.expiresOn ?? null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rego</CardTitle>
        <CardDescription>
          Current rego{isOnDirectDebit ? ": " : " expires: "}
          <RegoExpiry
            isOnDirectDebit={isOnDirectDebit}
            date={latestExpiry}
            status={expiryStatus(latestExpiry, expiry.today, expiry.warningDays)}
          />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {registrations.length === 0 ? null : (
          <ul className="flex flex-col divide-y">
            {registrations.map((registration) => (
              <RegoLine
                key={registration.id}
                vehicle={vehicle}
                registration={registration}
                today={expiry.today}
                attachments={props.attachments}
              />
            ))}
          </ul>
        )}
        {vehicle.archivedAt === null ? (
          <FormDialog triggerLabel="Add rego renewal" title="Add a rego renewal">
            <RegoForm
              initialValues={{ ...emptyRegoForm(), state: current?.state ?? vehicle.regoState }}
              runsOnFrom={latestExpiry ?? expiry.today}
              action={addRegoAction.bind(null, vehicle.id)}
              isGstRegistered={props.isGstRegistered}
            />
          </FormDialog>
        ) : null}
      </CardContent>
    </Card>
  );
}
